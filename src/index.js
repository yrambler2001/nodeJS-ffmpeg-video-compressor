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

const dirWithNotEncodedFiles = '/Volumes/SSD/PA/DONE';
const dirToSaveEncodedFiles = '/Users/yrambler2001/Documents/encoded';
const bitrate = '5500k';
const maxBitrate = '10000k';
const codec = 'h264';
const preset = 'veryslow';
const downScaleLong = 1920;
const downScaleShort = 1080;

const audioBitrate = '256k';

const secondsBetweenTwoDates = (d1, d2 = new Date()) => Math.abs((d1.getTime() - d2.getTime()) / 1000);
const numberTo2Digits = (n) => (n < 10 ? `0${n}` : n);

const secondsRangeToString = (secondsRange) => {
  let currentRange = Math.floor(secondsRange);
  const hours = Math.floor(currentRange / 3600);
  currentRange -= hours * 3600;
  const minutes = Math.floor(currentRange / 60);
  currentRange -= minutes * 60;
  const seconds = Math.floor(currentRange);
  return `${numberTo2Digits(hours)} hours, ${numberTo2Digits(minutes)} minutes, ${numberTo2Digits(seconds)} seconds`;
};
const getHHMMSSfromDate = (d = new Date()) => d.toTimeString().split(' ')[0];

const row = new Array(30).fill('-').join('');

const memoFFProbe = {};
const memoizedFFProbe = async (file) => {
  if (memoFFProbe[file]) { return memoFFProbe[file]; }
  memoFFProbe[file] = await ffprobe(file, { path: ffprobeStatic.path }); return memoFFProbe[file];
};

// ffmpeg -i VID_20200122_213850.mp4 -c:v h264 -b:v 5500k -maxrate:v 10000k -s 1080x1920 -preset veryslow t7.mp4
const getResizeParams = async (file) => {
  const a = (await memoizedFFProbe(file)).streams.find((stream) => stream.codec_type === 'video');
  const { width: rawWidth, height: rawHeight } = a;
  const rotate = a.tags && (((a.tags.rotate || 0) / 90) % 2 !== 0); // if video was encoded in landscape but has rotate to portrait tag;
  const width = rotate ? rawHeight : rawWidth;
  const height = rotate ? rawWidth : rawHeight;
  const isLandscape = width > height;
  if (isLandscape) {
    if (width > downScaleLong) return ['-s', `${downScaleLong}x${downScaleShort}`];
  } else if (height > downScaleLong) return ['-s', `${downScaleShort}x${downScaleLong}`];
  return [];
};
const getFileWeight = async (file) => {
  const { width, height, nb_frames: countFrames } = (await memoizedFFProbe(file)).streams.find((stream) => stream.codec_type === 'video');
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const weight = ((Math.min(long, downScaleLong) * Math.min(short, downScaleShort)) / 1000) * countFrames;
  return weight;
};
const findFiles = (dir, pattern) => new Promise((resolve, reject) => glob(pattern, { cwd: dir }, (error, files) => { if (error) reject(error); else resolve(files); }));

const App = async () => {
  const filesToProcessPromises = (
    await findFiles(dirWithNotEncodedFiles, path.join('**', '*.mp4'))).map((filePath) => path.join(dirWithNotEncodedFiles, filePath)).map(async (fullPath) => ({ weight: await getFileWeight(fullPath).catch(() => { }), path: fullPath }));
  let filesToProcess = [];
  const errorFiles = [];

  const initDate = new Date();
  let firstEstimate; let secondEstimate;
  await Promise.all(filesToProcessPromises);
  for await (const file of filesToProcessPromises) { if (file.weight) filesToProcess.push(file); else errorFiles.push(file); }
  filesToProcess = filesToProcess.sort((a, b) => a.weight - b.weight);// for better time statistics sort files by size and encode first small files
  const totalWeight = filesToProcess.reduce((prev, curr) => prev + curr.weight, 0);
  console.log(`total weight: ${totalWeight}`);
  let completedSeconds = 0;
  let completedWeight = 0;
  let startDate;
  for (const file of filesToProcess) {
    const outputFilePath = file.path.replace(dirWithNotEncodedFiles, dirToSaveEncodedFiles);
    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
    startDate = new Date();
    await new Promise(async (resolve) => {
      const process = spawn(
        ffmpeg,
        [
          '-y', // accept all Yes/No questions
          '-i', file.path, // input file
          '-c:v', codec, // codec to encode file
          '-b:v', bitrate, // result bitrate in sec
          '-b:a', audioBitrate,
          '-maxrate:v', maxBitrate, // max bitrate
          ...await getResizeParams(file.path), // if video is larger FullHD, scale down to FullHD
          '-preset', preset, // encoding quality preset
          outputFilePath,
        ],
        { stdio: 'inherit', stderr: 'inherit' }, // pipe all stdio to node process
      );
      process.on('close', () => resolve());
      // (new Promise((r) => setTimeout(r, file.weight / 10000))).then(() => resolve());
    });
    completedWeight += file.weight;
    completedSeconds += secondsBetweenTwoDates(startDate);
    const perSec = (completedWeight / completedSeconds);
    const estimateSeconds = (totalWeight - completedWeight) / perSec;
    const timeLeft = secondsRangeToString(estimateSeconds);
    if (!firstEstimate) firstEstimate = secondsRangeToString(estimateSeconds + completedSeconds);
    else if (!secondEstimate) secondEstimate = secondsRangeToString(estimateSeconds + completedSeconds);
    const percentComplete = ((completedWeight / totalWeight) * 100).toFixed(1);
    console.log(row);
    console.log(`${getHHMMSSfromDate()} ${Math.floor(perSec)} abstract units per sec. ${timeLeft} left. ${percentComplete}% complete`);
    console.log(row);
  }
  console.log(`${getHHMMSSfromDate()} Encoded in ${secondsRangeToString(secondsBetweenTwoDates(initDate))}`);
  console.log(`${getHHMMSSfromDate()} First estimate: ${firstEstimate}`);
  console.log(`${getHHMMSSfromDate()} Second estimate: ${secondEstimate}`);
  if (errorFiles.length) console.log('Error files:', errorFiles);
};
App();
