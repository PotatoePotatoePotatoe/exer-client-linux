"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.volumeCode = void 0;
// Core Audio interfaces preserve native vtable order, including unused slots.
exports.volumeCode = `using System; using System.Diagnostics; using System.Runtime.InteropServices;
public static class ExerVolume {
 [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Devices {void EnumAudioEndpoints();void GetDefaultAudioEndpoint(int flow,int role,out Device device);}
 [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Device {void Activate(ref Guid iid,int context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)] out object result);}
 [ComImport,Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Manager {void GetAudioSessionControl();void GetSimpleAudioVolume();void GetSessionEnumerator(out Sessions sessions);}
 [ComImport,Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Sessions {void GetCount(out int count);void GetSession(int index,[MarshalAs(UnmanagedType.IUnknown)] out object session);}
 [ComImport,Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Control {
  void GetState(out int state);void GetDisplayName();void SetDisplayName();void GetIconPath();void SetIconPath();
  void GetGroupingParam();void SetGroupingParam();void RegisterAudioSessionNotification();void UnregisterAudioSessionNotification();
  void GetSessionIdentifier();void GetSessionInstanceIdentifier();void GetProcessId(out uint pid);
 }
 [ComImport,Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Volume {void SetMasterVolume(float level,ref Guid context);void GetMasterVolume(out float level);}
 public static int ReadOrSet(int percent){
  var type=Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
  var devices=(Devices)Activator.CreateInstance(type);
  Device device;devices.GetDefaultAudioEndpoint(0,1,out device);
  Guid iid=typeof(Manager).GUID;object manager;device.Activate(ref iid,23,IntPtr.Zero,out manager);
  Sessions sessions;((Manager)manager).GetSessionEnumerator(out sessions);
  int count,fallback=-1,active=-1;sessions.GetCount(out count);
  for(int i=0;i<count;i++){
   try{
    object session;sessions.GetSession(i,out session);var control=(Control)session;
    uint pid;control.GetProcessId(out pid);
    using(var process=Process.GetProcessById((int)pid)){
     if(!String.Equals(process.ProcessName,"Spotify",StringComparison.OrdinalIgnoreCase))continue;
    }
    int state;control.GetState(out state);if(state==2)continue;
    var volume=(Volume)session;
    if(percent>=0){Guid context=Guid.Empty;volume.SetMasterVolume(percent/100f,ref context);}
    float level;volume.GetMasterVolume(out level);
    fallback=(int)Math.Round(level*100);if(state==1)active=fallback;
   }catch(COMException){}catch(ArgumentException){}catch(InvalidCastException){}
  }
  return active>=0?active:fallback;
 }
}`;
