'use strict';
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

const exePath = path.resolve(__dirname, '..', 'dist-electron', 'win-unpacked', 'SceneOCR.exe');
const icoPath = path.resolve(__dirname, 'icon.ico');

console.log('[set-icon] exe:', exePath);
console.log('[set-icon] ico:', icoPath);

const data = fs.readFileSync(exePath);
const exe = ResEdit.NtExecutable.from(data);
const res = ResEdit.NtExecutableResource.from(exe);

const icoData = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
console.log('[set-icon] ico entries:', icoData.icons.length);

const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
console.log('[set-icon] existing icon groups:', iconGroups.length);

ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  iconGroups.length > 0 ? iconGroups[0].id : 1,
  1033,
  icoData.icons.map(i => i.data)
);

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('[set-icon] done');
