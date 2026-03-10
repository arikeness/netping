const { app, BrowserWindow, ipcMain } = require("electron");
const { exec } = require("child_process");
const path = require("path");

let mainWindow;

function createWindow() {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "default",
    title: "NETPING PRO",
    backgroundColor: "#0a0d14",
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, "dist", "index.html");
    mainWindow.loadFile(indexPath).catch(err => {
      // dist bulunamazsa hata göster
      mainWindow.loadURL(`data:text/html,<h2>Hata: ${err.message}</h2><p>Path: ${indexPath}</p>`);
    });
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Gerçek ICMP Ping ──────────────────────────────────────────────────────────
// IP veya hostname doğrulama
function validateTarget(target) {
  const t = target.trim();
  if (!t) return { valid: false, error: "Boş hedef" };

  // Geçerli IPv4 kontrolü
  const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipMatch = t.match(ipRegex);
  if (ipMatch) {
    const parts = ipMatch.slice(1).map(Number);
    if (parts.every(p => p >= 0 && p <= 255)) return { valid: true };
    return { valid: false, error: `Geçersiz IP: Her oktet 0-255 arasında olmalı` };
  }

  // Hostname/domain kontrolü (harf, rakam, nokta, tire)
  const hostRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]{0,253}[a-zA-Z0-9])?$/;
  if (hostRegex.test(t)) return { valid: true };

  return { valid: false, error: `Geçersiz hedef: "${t}"` };
}

ipcMain.handle("ping", async (event, { ip, count, packetSize }) => {
  const validation = validateTarget(ip);
  if (!validation.valid) {
    return {
      ip, error: validation.error,
      results: [], avg: null, min: null, max: null, loss: 100, raw: ""
    };
  }

  return new Promise((resolve) => {
    const c = Math.min(Math.max(parseInt(count) || 4, 1), 20);
    const l = Math.min(Math.max(parseInt(packetSize) || 32, 8), 65500);

    // Windows ping komutu
    const cmd = `ping -n ${c} -l ${l} ${ip}`;

    exec(cmd, { timeout: (c + 2) * 3000 }, (error, stdout) => {
      const results = [];

      // Her satırı parse et
      const lines = stdout.split("\n");
      for (const line of lines) {
        // Türkçe Windows: "Yanıt süresi=5ms"
        // İngilizce Windows: "Reply from ... time=5ms"
        const trMatch = line.match(/s[üu]re[<=]\s*(\d+)\s*ms/i);
        const enMatch = line.match(/time[<=]\s*(\d+)\s*ms/i);
        const timeoutTR = /İstek zaman a[şs][ıi]m[ıi]|suresi doldu/i.test(line);
        const timeoutEN = /Request timed out|timed out/i.test(line);
        const unreachTR = /Hedef.*ula[şs][ıi]lam[ıi]yor/i.test(line);
        const unreachEN = /Destination.*[Uu]nreachable|could not find/i.test(line);

        if (trMatch) results.push(parseInt(trMatch[1]));
        else if (enMatch) results.push(parseInt(enMatch[1]));
        else if (timeoutTR || timeoutEN || unreachTR || unreachEN) results.push(null);
      }

      // Eğer hiç parse edemedik ama hata varsa hepsini null say
      if (results.length === 0 && error) {
        for (let i = 0; i < c; i++) results.push(null);
      }

      // Özet istatistik
      const valid = results.filter(r => r !== null);
      const avg   = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
      const min   = valid.length ? Math.min(...valid) : null;
      const max   = valid.length ? Math.max(...valid) : null;
      const loss  = results.length ? Math.round((results.filter(r => r === null).length / results.length) * 100) : 100;

      resolve({ ip, results, avg, min, max, loss, raw: stdout });
    });
  });
});

// ── Traceroute ────────────────────────────────────────────────────────────────
ipcMain.handle("traceroute", async (event, { ip }) => {
  return new Promise((resolve) => {
    const cmd = `tracert -d -w 2000 -h 30 ${ip}`;
    const hops = [];

    exec(cmd, { timeout: 90000 }, (error, stdout) => {
      const lines = stdout.split("\n");
      for (const line of lines) {
        // Windows tracert satır formatı
        // Türkçe: "  1    <1 ms    <1 ms    <1 ms  192.168.1.1"
        // Timeout: "  2     *        *        *     İstek zaman aşımı."
        const trimmed = line.trim();
        if (!trimmed || !/^\d+/.test(trimmed)) continue;

        const parts = trimmed.split(/\s+/);
        const hopNum = parseInt(parts[0]);
        if (isNaN(hopNum)) continue;

        const parseMs = (s) => {
          if (!s || s === "*") return null;
          if (s === "<1") return 1;
          const m = s.match(/^(\d+)$/);
          return m ? parseInt(m[1]) : null;
        };

        // parts[1..3] = ms değerleri, parts[4] = IP veya "ms" birleşik olabilir
        // Önce "ms" birimi ayrı mı entegre mi bak
        let ms1, ms2, ms3, hopIp;

        // Format: "1    <1 ms    <1 ms    <1 ms  x.x.x.x"
        // parts:  ["1", "<1", "ms", "<1", "ms", "<1", "ms", "x.x.x.x"]
        if (parts[2] === "ms" || parts[2] === "ms,") {
          ms1 = parseMs(parts[1]);
          ms2 = parseMs(parts[3]);
          ms3 = parseMs(parts[5]);
          hopIp = parts[7] || parts[6] || null;
        } else if (parts[1] === "*") {
          ms1 = null; ms2 = null; ms3 = null;
          hopIp = null;
        } else {
          ms1 = parseMs(parts[1]);
          ms2 = parseMs(parts[2]);
          ms3 = parseMs(parts[3]);
          hopIp = parts[4] || null;
        }

        // IP benzeri mi kontrol et
        if (hopIp && !/^\d+\.\d+\.\d+\.\d+$/.test(hopIp)) hopIp = null;

        const timeout = ms1 === null && ms2 === null && ms3 === null;

        hops.push({ hop: hopNum, ms: ms1, ms2, ms3, ip: hopIp, hostname: null, timeout });
      }

      resolve(hops);
    });
  });
});

// ── Port Tarama ───────────────────────────────────────────────────────────────
ipcMain.handle("portscan", async (event, { ip, ports }) => {
  const net = require("net");
  const results = [];

  for (const p of ports) {
    const result = await new Promise((res) => {
      const start  = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(1500);
      socket.on("connect", () => {
        const latency = Date.now() - start;
        socket.destroy();
        res({ port: p.port, service: p.svc, open: true, latency });
      });
      socket.on("timeout", () => { socket.destroy(); res({ port: p.port, service: p.svc, open: false, latency: null }); });
      socket.on("error",   () => { socket.destroy(); res({ port: p.port, service: p.svc, open: false, latency: null }); });
      socket.connect(p.port, ip);
    });
    results.push(result);
  }

  return results;
});

// ── DNS Çözümleme ─────────────────────────────────────────────────────────────
ipcMain.handle("dns-resolve", async (event, { domain }) => {
  const dns = require("dns");
  return new Promise((resolve) => {
    dns.lookup(domain, { all: true, family: 4 }, (err, addresses) => {
      if (err) {
        // lookup başarısız olursa resolve4 dene
        dns.resolve4(domain, (err2, addrs) => {
          if (err2) return resolve({ domain, error: err2.message, resolvedAt: Date.now() });
          resolve({ domain, ips: addrs, ttl: null, resolvedAt: Date.now() });
        });
      } else {
        const ips = addresses.map(a => a.address);
        resolve({ domain, ips, ttl: null, resolvedAt: Date.now() });
      }
    });
  });
});

// ── Subnet Tarama ─────────────────────────────────────────────────────────────
ipcMain.handle("subnet-scan", async (event, { subnet }) => {
  return new Promise((resolve) => {
    // Windows ARP taraması — önce ping flood at, sonra arp -a ile sonuçları al
    const base   = subnet.split(".").slice(0, 3).join(".");
    const pinged = [];
    let done = 0;

    for (let i = 1; i <= 254; i++) {
      const ip  = `${base}.${i}`;
      const cmd = `ping -n 1 -w 500 ${ip}`;
      exec(cmd, { timeout: 2000 }, () => {
        done++;
        if (done === 254) {
          // Tüm ping'ler gitti, arp tablosunu oku
          exec("arp -a", (err, stdout) => {
            const results = [];
            const lines   = stdout.split("\n");
            for (const line of lines) {
              const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-f-]+)\s+/i);
              if (m && m[1].startsWith(base) && !m[1].endsWith(".255") && !m[1].endsWith(".0")) {
                results.push({ ip: m[1], mac: m[2], alive: true, hostname: "", ms: null });
              }
            }
            resolve(results.sort((a, b) => {
              const al = parseInt(a.ip.split(".")[3]);
              const bl = parseInt(b.ip.split(".")[3]);
              return al - bl;
            }));
          });
        }
      });
    }
  });
});
