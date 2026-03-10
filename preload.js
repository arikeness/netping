const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  ping:         (args) => ipcRenderer.invoke("ping", args),
  traceroute:   (args) => ipcRenderer.invoke("traceroute", args),
  portScan:     (args) => ipcRenderer.invoke("portscan", args),
  dnsResolve:   (args) => ipcRenderer.invoke("dns-resolve", args),
  subnetScan:   (args) => ipcRenderer.invoke("subnet-scan", args),
  onTracerouteHop: (cb) => ipcRenderer.on("traceroute-hop", (_, hop) => cb(hop)),
  removeTracerouteListeners: () => ipcRenderer.removeAllListeners("traceroute-hop"),
});