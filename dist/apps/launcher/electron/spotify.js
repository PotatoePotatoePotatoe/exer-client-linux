"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openSpotify = openSpotify;
exports.spotify = spotify;
const spotify_volume_1 = require("./spotify-volume");
const node_child_process_1 = require("node:child_process");
const node_readline_1 = require("node:readline");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
async function openSpotify(openExternal, timeoutMs = 3500) {
    const open = async (url) => {
        let timer;
        try {
            await Promise.race([
                openExternal(url),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(Error('Spotify did not respond.')), timeoutMs);
                }),
            ]);
        }
        finally {
            clearTimeout(timer);
        }
    };
    try {
        await open('spotify:');
    }
    catch {
        await open('https://open.spotify.com/');
    }
}
const script = String.raw `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
 $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Length -eq 1 -and
 $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1'
} | Select-Object -First 1
function Await($operation,[Type]$type){
 $task=$asTask.MakeGenericMethod($type).Invoke($null,@($operation))
 $task.GetAwaiter().GetResult()
}
function Get-Session{
 if(!$global:manager){$global:manager=Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])}
 $global:manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match '^(Spotify\.exe|SpotifyAB\.SpotifyMusic_[^!]+!Spotify)$' } | Select-Object -First 1
}
`;
const status = String.raw `
function Get-Status{
$session=Get-Session
if(!$session){return 'null'}
$info=$session.GetPlaybackInfo()
$media=Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime])
$timeline=$session.GetTimelineProperties()
$art=$null
$key=[string]$media.Title+'|'+[string]$media.Artist
if($media.Thumbnail -and $key -ne $global:artKey){
 try{
  $stream=Await ($media.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime])
  try{
   # WinRT ContentType/Size are not visible through PowerShell's COM wrapper: read the whole stream (max 1 MB)
   # and re-encode it as a 160x160 PNG, the only format Minecraft's NativeImage reads.
   # PowerShell cannot cast the WinRT stream; reflection on the interface type queries it directly.
   $inputType=[Windows.Storage.Streams.IInputStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
   $reader=[System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead',[Type[]]@($inputType)).Invoke($null,@($stream))
   $memory=New-Object System.IO.MemoryStream
   $buffer=New-Object byte[] 65536
   while(($count=$reader.Read($buffer,0,$buffer.Length)) -gt 0 -and $memory.Length -le 1048576){$memory.Write($buffer,0,$count)}
   if($memory.Length -gt 0 -and $memory.Length -le 1048576){
    Add-Type -AssemblyName System.Drawing
    $memory.Position=0
    $source=[System.Drawing.Image]::FromStream($memory)
    try{
     $side=[Math]::Min($source.Width,$source.Height)
     $bitmap=New-Object System.Drawing.Bitmap 160,160
     $g=[System.Drawing.Graphics]::FromImage($bitmap)
     $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
     $g.DrawImage($source,(New-Object System.Drawing.Rectangle 0,0,160,160),[int](($source.Width-$side)/2),[int](($source.Height-$side)/2),$side,$side,[System.Drawing.GraphicsUnit]::Pixel)
     $g.Dispose()
     $png=New-Object System.IO.MemoryStream
     $bitmap.Save($png,[System.Drawing.Imaging.ImageFormat]::Png)
     $bitmap.Dispose()
     $art='data:image/png;base64,'+[Convert]::ToBase64String($png.ToArray())
     $global:artKey=$key
    }finally{$source.Dispose()}
   }
  }finally{if($reader){$reader.Dispose()}}
 }catch{}
}
@{title=$media.Title;artist=$media.Artist;art=$art;artKey=$key;playing=($info.PlaybackStatus.ToString() -eq 'Playing');
 position=$timeline.Position.TotalSeconds;duration=$timeline.EndTime.TotalSeconds;
 previous=$info.Controls.IsPreviousEnabled;next=$info.Controls.IsNextEnabled;
 toggle=($info.Controls.IsPlayPauseToggleEnabled -or $info.Controls.IsPlayEnabled -or $info.Controls.IsPauseEnabled)} | ConvertTo-Json -Compress
}
`;
const commands = {
    previous: '$session.TrySkipPreviousAsync()',
    next: '$session.TrySkipNextAsync()',
    toggle: "$(if($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing'){$session.TryPauseAsync()}else{$session.TryPlayAsync()})",
};
// One PowerShell stays open while the launcher uses Spotify: starting powershell.exe and loading WinRT and the volume
// code took 1-2 s per request. It reads one request per line and answers one JSON line; it closes after a minute idle.
const host = String.raw `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
` + script + 'Add-Type -TypeDefinition @\'\n' + spotify_volume_1.volumeCode + '\n\'@\n' + status + String.raw `
function Run-Command($name){
 $session=Get-Session
 if(!$session){return 'null'}
 $op=switch($name){'previous'{` + commands.previous + '}\'next\'{' + commands.next + '}\'toggle\'{' + commands.toggle + String.raw `}}
 Await $op ([bool]) | ConvertTo-Json -Compress
}
while($true){
 $line=[Console]::In.ReadLine()
 if($line -eq $null){break}
 try{
  $out=if($line -eq 'status'){Get-Status}elseif($line -like 'volume *'){[ExerVolume]::ReadOrSet([int]$line.Substring(7)) | ConvertTo-Json -Compress}else{Run-Command $line}
 }catch{$out='null'}
 [Console]::Out.WriteLine([string]$out)
 [Console]::Out.Flush()
}
`;
let ps = null;
let waiting = [];
let chain = Promise.resolve();
let idle;
const cover = { key: '', art: null };
function start() {
    const file = node_path_1.default.join(node_os_1.default.tmpdir(), 'exer-spotify-host.ps1');
    node_fs_1.default.writeFileSync(file, '\ufeff' + host);
    const child = (0, node_child_process_1.spawn)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
    (0, node_readline_1.createInterface)({ input: child.stdout }).on('line', line => waiting.shift()?.(line));
    child.stderr.resume();
    child.on('exit', () => { if (ps === child)
        ps = null; for (const w of waiting.splice(0))
        w(null); });
    ps = child;
}
process.once('exit', () => ps?.kill());
function ask(line, timeoutMs = 7000) {
    const next = chain.then(() => new Promise(resolve => {
        if (!ps)
            start();
        const child = ps;
        const timer = setTimeout(() => { child.kill(); resolve(null); }, timeoutMs);
        waiting.push(answer => { clearTimeout(timer); resolve(answer); });
        child.stdin.write(line + '\n');
    }));
    chain = next.catch(() => null);
    clearTimeout(idle);
    idle = setTimeout(() => { ps?.kill(); ps = null; }, 60000);
    idle.unref?.();
    return next;
}
async function spotify(action, volume = -1) {
    if (process.platform !== 'win32')
        return null;
    const line = await ask(action === 'volume' ? 'volume ' + Math.round(volume) : action);
    if (line == null)
        return null;
    const result = JSON.parse(line.trim());
    // The cover comes only when the track changes: keep it for the following answers.
    if (result && action === 'status') {
        if (result.art) {
            cover.key = result.artKey;
            cover.art = result.art;
        }
        else if (result.artKey === cover.key)
            result.art = cover.art;
        delete result.artKey;
    }
    return result;
}
