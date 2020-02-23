/* eslint-disable no-console */
/* eslint-disable max-len */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-async-promise-executor */
const fs = require('fs');
const ffprobe = require('ffprobe');
const ffprobeStatic = require('ffprobe-static');
const glob = require('glob');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const moment = require('moment');
const momentDurationFormatSetup = require('moment-duration-format');

momentDurationFormatSetup(moment);

const folderToProcess = 'DONE';
const folderToSave = 'DONE_ENCODED';
const bitrate = '5500k';
const maxBitrate = '10000k';
const codec = 'h264';
const preset = 'veryslow';

const row = new Array(30).fill('-').join('');

const memoFFProbe = {};
const memoizedFFProbe = async (file) => {
  if (memoFFProbe[file]) { return memoFFProbe[file]; }
  memoFFProbe[file] = await ffprobe(file, { path: ffprobeStatic.path }); return memoFFProbe[file];
};

// ffmpeg -i VID_20200122_213850.mp4 -c:v h264 -b:v 5500k -maxrate:v 10000k -s 1080x1920 -preset veryslow t7.mp4
const doneDirPath = path.join(process.cwd(), '..', folderToProcess);
const getResizeParams = async (file) => {
  const a = (await memoizedFFProbe(file)).streams.find((stream) => stream.codec_type === 'video');
  const { width: rawWidth, height: rawHeight } = a;
  const rotate = a.tags && (((a.tags.rotate || 0) / 90) % 2 !== 0); // if video was encoded in landscape but has rotate to portrait tag;
  const width = rotate ? rawHeight : rawWidth;
  const height = rotate ? rawWidth : rawHeight;
  const isLandscape = width > height;
  if (isLandscape) {
    if (width > 1920) return ['-s', '1920x1080'];
  } else if (height > 1920) return ['-s', '1080x1920'];
  return [];
};
const getFileWeight = async (file) => {
  const { width, height, nb_frames: countFrames } = (await memoizedFFProbe(file)).streams.find((stream) => stream.codec_type === 'video');
  const weight = ((Math.min(width, 1920) * Math.min(height, 1920)) / 1000) * countFrames;
  return weight;
};
const findFiles = (dir, pattern) => new Promise((resolve, reject) => glob(pattern, { cwd: dir }, (error, files) => { if (error) reject(error); else resolve(files); }));

const App = async () => {
  const filesToProcessPromises = (
    await findFiles(doneDirPath, '**\\*.mp4')).map((filePath) => path.join(doneDirPath, filePath)).map(async (fullPath) => ({ weight: await getFileWeight(fullPath).catch(() => { }), path: fullPath }));
  let filesToProcess = [];
  const errorFiles = [];

  await Promise.all(filesToProcessPromises);
  for await (const file of filesToProcessPromises) { if (file.weight) filesToProcess.push(file); else errorFiles.push(file); }
  filesToProcess = filesToProcess.sort((a, b) => a.weight - b.weight);// for better time statistics sort files by size and encode first small files
  const totalWeight = filesToProcess.reduce((prev, curr) => prev + curr.weight, 0);
  if (errorFiles.length) console.log('error files:', errorFiles);
  console.log(`total weight: ${totalWeight}`);
  const start = moment();
  let completedWeight = 0;
  for (const file of filesToProcess) {
    const outputFilePath = file.path.replace(folderToProcess, folderToSave);
    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
    await new Promise(async (resolve) => {
      const process = spawn(
        ffmpeg,
        [
          '-y', // accept all Yes/No questions
          '-i', file.path, // input file
          '-c:v', codec, // codec to encode file
          '-b:v', bitrate, // result bitrate in sec
          '-maxrate:v', maxBitrate, // max bitrate
          ...await getResizeParams(file.path), // if video is larger FullHD, scale down to FullHD
          '-preset', preset, // encoding quality preset
          outputFilePath,
        ],
        { stdio: 'inherit', stderr: 'inherit' }, // pipe all stdio to node process
      );
      process.on('close', () => resolve());
    });
    completedWeight += filesToProcess[0].weight;
    const currentEndMoment = moment();
    const currentDurationInSecs = currentEndMoment.diff(start, 'seconds', true);
    const perSec = (completedWeight / currentDurationInSecs);
    console.log(row);
    console.log(`${perSec} abstract units per sec. ${moment.duration((totalWeight - completedWeight) / perSec, 'seconds').format('h [hrs], m [min]')} left. ${((completedWeight / totalWeight) * 100).toFixed(1)}% complete`);
    console.log(row);
  }
};
App();
