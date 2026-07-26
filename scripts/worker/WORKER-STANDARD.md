# WORKER PROVISIONING STANDARDI v1
### "Herhangi bir Windows+NVIDIA makinesini, herhangi bir zamanda, aynı şekilde worker yap"

> **Kaynak:** 2026-07-26/27 `rtx-worker` (RTX 5070 Laptop + Ryzen 9 8945HX) kurulumu.
> Bu dokümandaki her satır **o kurulumda ölçülmüş bir çıktıya** dayanır. Uydurma yok:
> bir adımın kanıtı yoksa "doğrulanmadı" diye işaretlidir.
>
> **Kullanım:** `bash provision-worker.sh <tailscale-ip>` — bölüm A'yı otomatik uygular.
> Bölüm B, script'in **yapmadığı** şeylerin ve nedenlerinin kaydıdır.

---

## 00. KAPSAM ve ÖNKOŞULLAR *(script koşulmadan önce okunur)*

### Kapsam — ne için doğrulandı
| | |
|---|---|
| **Hedef makine** | Windows 11 (build ≥ 22621) + NVIDIA GPU. Ölçüldüğü donanım: RTX 5070 Laptop 8 GB + Ryzen 9 8945HX 16c/32t + 31 GB RAM |
| **Kontrol makinesi** | macOS (Tailscale + SSH + git). Aynı tailnet'te olmalı |
| **KAPSAM DIŞI (doğrulanmadı)** | Linux worker · macOS worker · AMD/Intel GPU · Windows 10 · birden çok GPU · domain'e katılmış makine. Bunlar için standart **geçerli değildir** — denenmedi, iddia edilmez |

### Önkoşul 1 — K1 kod fix'i (dispatch bunu ŞART koşar)
Worker kurulsa bile, dispatch **ölü backend'e** gidebilir. Ölçüldü: `contract:m_0d304dbd1045fadb`
(100.64.0.7, tailnet üyesi bile değil) codegen görevini kazandı, çünkü `buildWorkers` her havuz
girdisini `healthy: true` sayıyordu ve `tokS` boş olduğu için sıralama alfabetiğe düşüyordu.
Ayrıca `probeBackend` yalnız ollama'yı tanıyordu (`/api/version`); ollamas gateway `:8090`'da
o uç yok → çalışan gateway "unreachable" görünüyordu.

**Gerekli commit:** `fix/k1-dispatch-probe-aware` (`16d3000`) — `probeBackend` gateway'in
`/api/health` ucunu da dener, `buildWorkers(pool, mac, gemini, probes?)` probe'u otoriter kabul
eder, `runDispatch` atamadan önce `probeAll` koşar. Bu fix olmadan Faz 7-9 anlamsızdır.

### Önkoşul 2 — sırlar ve kimlik
- Kontrol makinesinde worker'a **ayrı** SSH anahtarı (`~/.ssh/id_<alias>`); başka anahtar taşınmaz
- Worker'ın `MASTER_KEY_B64`'ü **hedefte** üretilir, orada kalır
- Hedefte ASCII adlı **adanmış servis hesabı** açılır; kişisel profil kullanılmaz

---

## 0. Sözleşmeler (her fazda geçerli)

| Kural | Gerekçe (ölçülmüş) |
|---|---|
| **MISS ≠ PASS** — ölçülemeyen adım geçmiş sayılmaz | Sıcaklık ölçülemeyince "iyi" varsaymak donanımı riske atar; kapı `PAUSE` verir |
| **Kanıt = komut + ham çıktı** | "Yazdım" ≠ "uygulandı": `.wslconfig` yazıldı ama bir anahtarı reddedildi (Y-11); `nproc` ölçümü ortaya çıkardı |
| **Taşıma yalnız base64** | Sohbet/kabuk katmanları `_` ve `*` yutar (Y-12) |
| **Tek kök klasör** — `C:\ecy\` (Windows) · `/opt/ecy/` (WSL) | Dağınık kurulum taşınamaz ve denetlenemez; modeller sistem profiline sızmıştı |
| **Hedef makinede üretilen sır hedefte kalır** | Worker'ın `MASTER_KEY_B64`'ü orada üretilir; kontrol makinesinin anahtarı asla kopyalanmaz |
| **Donanım koruma pazarlık konusu değil** | 7/24 yük mobil termal zarfta çalışıyor |

---

## A. DOĞRU YÖNTEM

### Faz 0 — Ağ + yönetim kanalı  *(insan eli gereken TEK faz: 1 yapıştırma)*

| # | Adım | Kabul kanıtı |
|---|---|---|
| 0.1 | Tailscale'i aynı tailnet'e bağla | `tailscale ping <ip>` → `pong … in 6-10ms`, **direct** |
| 0.2 | **ASCII makine adı** + reboot | `COMPUTER=rtx-worker` |
| 0.3 | OpenSSH Server (`Add-WindowsCapability … OpenSSH.Server~~~~0.0.1.0`) | `SSH-2.0-OpenSSH_for_Windows_9.5` — FoD indirmesi **~680 sn** sürebilir, sabır |
| 0.4 | `sshd` StartupType=Automatic + Start | `SSHD=Running` |
| 0.5 | Firewall: `22,11434,8090` ← yalnız `100.64.0.0/10` + ev LAN'ı | `Enabled: True`, Action Allow, Direction Inbound |
| 0.6 | ASCII adlı servis hesabı + Administrators | `ACCT=ollamas` |
| 0.7 | Hesabın profilini oluştur: `schtasks /ru <user> /rp <pw>` ile bir kez koştur | `PROFILE=True` |
| 0.8 | Kontrol makinesinde ayrı anahtar; public → `administrators_authorized_keys`; `icacls /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"` | `ssh -i <key> <user>@<ip> hostname` → makine adı |
| 0.9 | `~/.ssh/config` → `Host` girdisi | `ssh <alias> <cmd>` çalışır |
| **0.10** | **GÜÇ AYARLARI — uyku/hazırda-bekletme/kapak kapalı (AC)** | `powercfg /query SCHEME_CURRENT SUB_SLEEP` → `AC Power Setting Index: 0` |

```powershell
powercfg /change standby-timeout-ac 0        # uyku yok
powercfg /change hibernate-timeout-ac 0      # hazirda bekletme yok
powercfg /change monitor-timeout-ac 15       # yalniz ekran kapanir (fan/ses azalir)
# kapak kapali = hicbir sey yapma (AC'de)
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setactive SCHEME_CURRENT
# Windows Update yeniden baslatmalarini calisma saatlerine kilitle
```

**Sıra önemli — iki kural, ikisi de acıyla öğrenildi:**
- **0.2 (ASCII ad) SSH'tan ÖNCE** gelmeli — sonra düzeltmek bir reboot daha demek (Y-1)
- **0.10 (güç ayarları) Faz 0'da** olmalı, sonda değil. Bu kurulumda Faz 7'ye bırakıldı, sıra
  hiç gelmedi ve **makine kurulumun ortasında uyudu** (Y-15). 7/24 iddiası bu adımın kanıtı
  olmadan geçersizdir; bu bir sonuç değil **önkoşuldur** — uyuyan makinede sonraki hiçbir faz
  koşamaz.

### Faz 1 — Envanter *(salt-okunur; sonraki fazlar buna göre dallanır)*

| # | Ölçüm | Bu makinede çıkan |
|---|---|---|
| 1.1 | `nvidia-smi --query-gpu=name,memory.total,driver_version` | `RTX 5070 Laptop GPU, 8151 MiB, 610.74` |
| 1.2 | CPU / RAM / boş disk / Windows build | `Ryzen 9 8945HX 16c/32t` · `31.2 GB` · `91.7 GB` · `26200` |
| 1.3 | WSL yeteneği **özellikten** (Y-3) | `Microsoft-Windows-Subsystem-Linux = Disabled` |
| 1.4 | **Kapı:** disk ≥ 80 GB · VRAM ölçüldü · RAM ≥ 16 GB | `KAPI: PASS` değilse dur |

**Kaynak profili çıkarımı:** VRAM dar + çekirdek bol ⇒ worker **CPU-öncelikli** kurulur
(pipeline/test/Docker buraya, inference tek model). Profil ölçümden türetilir, varsayılmaz.

### Faz 2 — Tek kök klasör *(ilk iş; sonradan taşımak pahalı)*

| # | Adım | Kanıt |
|---|---|---|
| 2.1 | `C:\ecy\{ollama\models, wsl, worker, tmp}` | `KOK_OLUSTU=True` |
| 2.2 | `OLLAMA_MODELS=C:\ecy\ollama\models` — **Ollama kurulmadan ÖNCE** | Sonradan yapılırsa 12.75 GB robocopy gerekti |
| 2.3 | WSL içinde `/opt/ecy/` | — |

### Faz 3 — Windows-native GPU katmanı

| # | Adım | Kanıt |
|---|---|---|
| 3.1 | Ollama **resmi installer** ile (`/VERYSILENT /NORESTART`) — winget yok (Y-5) | `INDIRILDI_MB=1490.1` → `OLLAMA_KURULDU` |
| 3.2 | Kalıcı env (Machine): `OLLAMA_HOST=0.0.0.0:11434` · `KEEP_ALIVE=30m` · `MAX_LOADED_MODELS=1` · `NUM_PARALLEL=1` · `NUM_THREAD=<fiziksel>` | `ENV_SET=0.0.0.0:11434` · `MAX_LOADED=1` · `NUM_THREAD=16` |
| 3.3 | Boot görevi: Task Scheduler / **SYSTEM** / `-AtStartup` / `ExecutionTimeLimit=0` | `TASK_STATE=Running` · `LISTENING=True` |
| 3.4 | Kontrol makinesinden erişim | `curl :11434/api/tags` → **200** |
| 3.5 | Model seti VRAM'den; her model için **tok/s ölç**, <15 tok/s düşür | `qwen3:4b 112.2` · `qwen2.5vl:7b 47.8` · `qwen3:8b 24.1` |

> `0.0.0.0` bind bilinçlidir (tailnet arayüzü için) — **güvenlik firewall'da** sağlanır (0.5).
> Geniş bind + dar erişim.

### Faz 4 — WSL2 POSIX katmanı

| # | Adım | Kanıt |
|---|---|---|
| 4.1 | `Enable-WindowsOptionalFeature -All -NoRestart`: WSL + VirtualMachinePlatform → **reboot** | `WSL_FEATURE=Enabled` · `VMP_FEATURE=Enabled` |
| 4.2 | WSL çekirdeği **GitHub MSI**'ından (`microsoft/WSL` → `wsl.*.x64.msi`, `msiexec /quiet`) — Store yok (Y-6) | `WSL_VERSION=2.7.11.0` · çekirdek `6.18.33.2` |
| 4.3 | `wsl --install -d Ubuntu --no-launch` *(çekirdek kurulduktan sonra çalışır)* | `Dağıtım başarıyla yüklendi` · `Ubuntu 26.04 LTS` |
| 4.4 | `.wslconfig`: `processors=<fiziksel>` · `memory=<RAM/2>GB` · `swap=4GB` · `networkingMode=mirrored` · **`vmIdleTimeout=-1`** | `WSL_NPROC=16` · `RAM_GB=15` · `SWAP_GB=4` **ölçüldü** |
| 4.5 | `/etc/wsl.conf`: `[boot] systemd=true` + `[user] default=root` → `wsl --shutdown` | `SYSTEMD=running` |
| 4.6 | Paketler: node 22 · git · build-essential · python3 · **docker-ce** (Desktop değil) | `NODE=v22.23.1` · `DOCKER=29.6.2` · `DOCKER_ACTIVE=active` |
| 4.7 | **Docker daemon'a sabit DNS** (`/etc/docker/daemon.json` → `1.1.1.1`,`8.8.8.8`) | `DOCKER_HELLO=BASARILI` |
| 4.8 | Dağıtımı tek köke taşı: `--export` → `--unregister` → `--import C:\ecy\wsl` | `ext4.vhdx` 2.85 → **1.54 GB** (export sıkıştırır) |

### Faz 5 — Worker servisi

| # | Adım | Kanıt |
|---|---|---|
| 5.1 | `git clone --depth 1 --branch <br> https://…` (public HTTPS → anahtar paylaşımı yok) | `HEAD=cd1f01c` · `REPO_MB=36` |
| 5.2 | **`npm install`** (`npm ci` değil — Y-9) | `1621 packages in 48s` · `TSX=VAR` |
| 5.3 | systemd unit: `Environment=` ile değişkenler (`.env` yok — Y-10) + `CPUWeight=70` · `MemoryMax=<RAM*0.6>G` | `SERVIS=active` · `Main PID … (node)` |
| 5.4 | `MASTER_KEY_B64` **hedefte üretilir**, drop-in `chmod 600` | `DROPIN_MOD=600` · `masterKeySource:"env"` |
| 5.5 | WSL keepalive görevi **kullanıcı kimliğiyle** (SYSTEM olmaz — Y-8) | `WSL_DURUM=Ubuntu Running` · `:8090` dinliyor |
| 5.6 | Uçtan uca | `curl :8090/api/health` → **200**, gövde `"release":"…microsoft-standard-WSL2"` |

### Faz 6 — Donanım koruma *(7/24 için zorunlu)*

| # | Adım | Kanıt |
|---|---|---|
| 6.1 | Termal bekçi 60 sn; bölgeler **`InstanceName` ile** (Y-4); log 5 MB'de rotasyon | `cpu_max=59 (ECTZ_0=59 TZ01_0=59) gpu=44 durum=OK` |
| 6.2 | Eşik: >85 uyarı · >95 `PAUSE` · **ölçülemezse PAUSE** | kritik noktalar: `ECTZ_0=114` · `TZ01_0=125` |
| 6.3 | Güç planı **Dengeli**; `NUM_THREAD`=fiziksel; systemd `CPUWeight<100` | `POWER_PLAN=Dengeli` |
| 6.4 | Artık temizliği: installer'lar · `%TEMP%` >50 MB · boş dizinler | `SILINEN_MB=1737` · disk 67.2 → **68.3 GB** |

### Faz 7 — Kontrol düzlemi entegrasyonu *(worker'ı Mac'e TANITMA — atlanırsa dispatch çalışmaz)*

Faz 6'ya kadar worker ayaktadır ama **Mac onu bilmez**. Bu fazın atlanması, bu oturumda
yaşanan en sinsi hatadır: her şey "kurulu" görünür, dispatch sessizce mac'e düşer.

| # | Adım | Kabul kanıtı |
|---|---|---|
| 7.1 | Havuza **iki** girdi (amaca göre ayrı): `<alias>` → `http://<ip>:8090` (agent dispatch) ve `<alias>-ollama` → `http://<ip>:11434` (ham inference). İdempotent — varsa güncellenir | `ollamas remote ls` → ikisi de listede |
| 7.2 | **Ölü girdi temizliği:** havuzdaki her girdi probe edilir; tailnet üyesi olmayan / erişilemeyen girdiler **yedek alınarak** silinir | ölçüldü: `100.64.0.7` · `100.64.0.8` tailnet üyesi değil, `curl → 000` → silindi |
| 7.3 | Girdi sırası = fallback zinciri: dispatch girdisi (`:8090`) **önce**, inference (`:11434`) sonra | `priority` 10 / 20 |

> **Neden iki girdi:** dispatch `POST /api/agent/chat` atar → bu **ollamas gateway** ucudur (`:8090`).
> `:11434` ise ham Ollama'dır; orada böyle bir uç yok. Tek girdiyle kurulan havuz ya dispatch'i
> ya inference'ı kaybeder (K1'in yarısı buydu).

### Faz 8 — Mac watchdog *(7/24'ün Mac tarafı)*

| # | Adım | Kabul kanıtı |
|---|---|---|
| 8.1 | `com.ecy.worker-health.plist` — 5 dk periyot, `~/.ollamas/worker/health.log` (rotasyonlu) | `launchctl list \| grep worker-health` |
| 8.2 | Sağlık düşükse SSH ile **sırayla** onarım: Ollama görevi → WSL keepalive → `ollamas-worker` servisi | log satırı `repair=...` |
| 8.3 | 3 ardışık başarısızlıkta worker priority'si **geçici düşürülür** (iş Mac'e akmaya devam eder, kuyruk tıkanmaz); worker dönünce priority **geri alınır** | log `demote`/`restore` |
| 8.4 | Termal `PAUSE` bayrağı görülürse dispatch duraklatılır (donanım koruma Mac'e yansır) | log `thermal-pause` |
| 8.5 | **Mevcut `com.ecy.*` işlerine DOKUNULMAZ** — yalnız yeni bir agent eklenir | `launchctl list` öncesi/sonrası diğer işler aynı |

### Faz 9 — Uçtan uca kabul kapısı

`verify-worker.sh` — Mac'ten koşan tek yeşil/kırmızı kapı. **MISS ≠ PASS:** ölçülemeyen kontrol
"geçti" sayılmaz, `KOŞULMADI` olarak raporlanır.

| # | Kontrol | PASS koşulu |
|---|---|---|
| 1 | Tailscale | worker `online=true` |
| 2 | SSH | `ssh <alias> hostname` < 10 sn |
| 3 | Güç ayarı | `SUB_SLEEP` AC index **0** (uyku kapalı) |
| 4 | GPU | `nvidia-smi` VRAM + sürücü raporluyor |
| 5 | Ollama | `:11434/api/tags` **200** + beklenen model seti |
| 6 | Worker gateway | `:8090/api/health` **200** |
| 7 | WSL2 | `systemctl is-system-running` ∈ {running, degraded} · docker `active` |
| 8 | Havuz | `<alias>` + `<alias>-ollama` kayıtlı, ölü girdi yok |
| 9 | **Dispatch e2e** | `worker:"<alias>"` · `failedOver:false` · `demoSuspected:false` |
| 10 | **Failover** | worker durdurulur → görev Mac'te DONE → worker geri gelir |
| 11 | Termal | son log satırı `durum=OK\|UYARI`, `PAUSE` bayrağı yok |
| 12 | Disk | boş alan ≥ 40 GB (model+WSL+docker sonrası tampon) |

---

## B. YANLIŞ YÖNTEMLER — script bunları YAPMAZ

| # | Yanlış | Ölçülen sonuç | Doğrusu |
|---|---|---|---|
| **Y-1** | ASCII olmayan makine adıyla devam | `fatal: ga_init, unable to resolve user barÄ±ÅŸ\ollamas` → sshd child ölür → `Connection reset` (8 deneme boyunca) | Faz 0.2: ASCII ad, SSH'tan önce |
| **Y-2** | `sshd_config`'e **append** | Satırlar `Match Group administrators` içine düştü → `Restart-Service: Failed to start` → **SSH tamamen kapandı** | Global directive ilk `Match`'ten **önce**; `sshd.exe -t` ile doğrula; kalırsa `.bak`'tan otomatik dön |
| **Y-3** | `Get-Command wsl` ile yetenek ölçmek | `has_wsl=True` ama özellik `Disabled` — kurulum düştü | `Get-WindowsOptionalFeature` — yeteneği **kendi otoritesinden** sor |
| **Y-4** | Termal sensör `Select-Object -First 1` | `MSACPI=89/PERF=51.9` sonra `52/89.9` — **sahte 89 °C alarmı**; gerçek 59-67 | Bölgeleri `InstanceName` ile oku, **maksimumu** al |
| **Y-5** | winget ile kurulum | `winget_in_path=False` (paket var, yeni servis hesabına register değil; AppX SSH bağlamında kırılgan) | Resmi installer'ı doğrudan indir |
| **Y-6** | Store'a bağımlı `wsl --install` (çekirdek yokken) | `WSL_APPX=YOK` · `wsl --status` **EXIT=50** | Önce GitHub MSI, sonra `wsl --install -d` |
| **Y-7** | Ubuntu rootfs'i `cloud-images.ubuntu.com/wsl/…tar.gz` | **404** — tarball'lar kaldırılmış, yalnız `.manifest` var | `wsl --install -d Ubuntu` (WSL kendi CDN'i) |
| **Y-8** | WSL görevini **SYSTEM** olarak | `Wsl/WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED` · `LastTaskResult=4294967295` | `schtasks /ru <user> /rp <pw>` — kullanıcı kimliği |
| **Y-9** | `npm ci` | `Missing: proxy-agent@8.0.2 from lock file` (+5) — repo lock'u drift | `npm install`; lock drift **ayrı iş** olarak raporlanır |
| **Y-10** | `.env` dosyası yazmak | Güvenlik hook'u engelledi + gereksiz | systemd `Environment=`; sırlar drop-in `chmod 600` |
| **Y-11** | `.wslconfig`'e `autoMemoryReclaim=gradual` | `bilinmeyen anahtar` uyarısı — tüm config riske girer | Yalnız doğrulanmış anahtar; sonra `nproc`/`free -g` ile **ölç** |
| **Y-12** | Uzun çıktıyı sohbetten kopyalatmak | `_`/`*` **iki yönde** yutuluyor (`__PROGRAMDATA__`→`_PROGRAMDATA_`); 4444 karakterlik satır sarmalanıp kopyalanamadı | Komut: `-EncodedCommand` base64; çıktı: gzip+base64; ideali Taildrop |
| **Y-13** | WSL2'yi boşta bırakmak | `Ubuntu STATE=Stopped` — VM kapandı, `:8090` öldü (Ollama ayakta kaldı) | `vmIdleTimeout=-1` + kullanıcı kimlikli keepalive |

---

### Y-17 — worker'ı kurup **kontrol düzlemine tanıtmamak** *(en sinsi hata: her şey "kurulu" görünür)*
Faz 0-6 tamamlandı, worker `:8090`'da `active`, Mac'ten `/api/health` **200** döndü — yani
"kurulum bitti" denebilirdi. Ama dispatch denendiğinde:
```
worker:"contract:m_0d304dbd1045fadb"   failedOver:true   errors:["fetch failed"]
```
İş **ölü bir backend'e** gitti, sonra sessizce mac'e düştü. Sebep: worker havuza tanıtılmamış,
ölü girdiler temizlenmemiş, K1 fix'i uygulanmamıştı. `remote ls` fleet'i "kullanılabilir"
gösteriyordu — **yanlış güven veren bir gösterge**.

**Yerine:** Faz 7 (havuz kaydı + ölü girdi temizliği) ve Faz 9 (dispatch e2e kapısı) **zorunlu**
fazlardır. Kurulum, `worker:"<alias>"` + `failedOver:false` kanıtı alınmadan bitmiş sayılmaz.
"Servis ayakta" ≠ "iş worker'da koşuyor".

### Y-15 — güç ayarlarını sona bırakmak *(en pahalı hata: kurulumu kesti)*
Güç ayarları planın **Faz 7**'sine konulmuştu. Sıra hiç gelmedi ve makine kurulumun ortasında
uyudu:
```
tailscale: rtx-worker  online=False  lastseen=2026-07-26T21:40:00
ping → timed out · ssh → timed out · :11434 → 000err · :8090 → 000err
```
Ollama ve worker servisi kurulu, keepalive görevi kurulu, `vmIdleTimeout=-1` ayarlı — **hepsi
boşa**, çünkü makinenin kendisi uyudu. `Restart=always`, `RestartCount`, keepalive: hiçbiri
uyuyan bir makineyi uyandırmaz.

**Yerine:** güç ayarları **Faz 0.10**'a taşındı — SSH kurulduktan hemen sonra, envanterden bile
önce. Gerekçe: 7/24 çalışma bir *hedef* değil **önkoşuldur**; uyuyan makinede hiçbir faz koşamaz
ve her kesinti manuel müdahale gerektirir.

### Y-16 — unquoted heredoc içinde PowerShell backtick'i *(sessiz kusur: `bash -n` görmez)*
`provision-worker.sh` içinde PowerShell kodu bash heredoc'larıyla taşınıyor. Değişken
genişletmesi gerektiği yerlerde heredoc **unquoted** (`<<PSEOF`) olmak zorunda — ama orada bash
backtick'i **command substitution** olarak yorumlar:
```
$ bash -n script.sh          → sozdizimi OK          ← kusuru GORMEZ
$ bash script.sh             → bad substitution: no closing "`" in `0","" son
                               RENDER=[]              ← blok TAMAMEN BOS gider
```
Etkilenen 5 satır: PowerShell satır devamı ` `` ` (3 yer), `` `n `` newline (1), `` -replace "`0" `` (1).
Hepsi sessizce boş/bozuk render edilecekti — uzak makineye **eksik komut** gidecekti.

**Yerine:** unquoted heredoc'ta backtick **hiç kullanılmaz**:
| Backtick'li | Yerine |
|---|---|
| satır sonu ` `` ` (devam) | satırı tek satıra topla |
| `` "`n" `` | `@("a","b") -join [string][char]10` |
| `` -replace "`0","" `` | `.Replace([char]0,'')` |

Backtick yalnız `<<'PSEOF'` (**quoted**) bloklarda güvenlidir — orada bash hiçbir şey genişletmez.

**Ders:** `bash -n` yalnız *sözdizimi* kontrolüdür; heredoc içeriğinin **doğru render edildiğini
kanıtlamaz**. Standarda kalıcı **T4 render testi** eklendi: her unquoted heredoc gerçekten
render edilir, `stderr` boş ve çıktı dolu olmalı.

### Y-14 — bonus: **anti-desen testinin kendisi** yanlış pozitif üretti
Standardı doğrulayan regresyon testi ilk iki koşuda **kendi yanlış pozitiflerini** verdi:

| Test hatası | Ölçülen | Doğrusu |
|---|---|---|
| `-First 1` deseni geniş arandı | 4 "ihlal" bulundu; hepsi **meşru** (tek CPU seçme, dosya bulma, MSI varlığı) | Y-4 yalnız termal sensör için geçerli → `MSAcpi.*First 1` |
| Yorum satırları taranmaya dahil | `sshd_config` "ihlali" — oysa ikisi de *"dokunulmaz"* notuydu | `grep -vE '^\s*#'` ile yorumları dışla |

**Ders:** kural denetleyicisi de bir ölçüm aracıdır ve kendisi ölçülmeden güvenilmez.
Bir lint kuralı yazarken **kapsamı daralt** (hangi bağlamda yasak) ve **yorum satırlarını dışla**;
yoksa gürültü gerçek bulguyu gömer. *(CLAUDE.md'de kayıtlı 119-yanlış-pozitif dersinin aynısı.)*

### Doğrulama sonucu (2026-07-27, ölçüldü)
```
T1 sözdizimi     : bash -n provision-worker.sh → OK · lib.sh → OK
T2 anti-desen    : Y-2 · Y-4 · Y-5 · Y-9 · Y-10 · Y-11 → altısı da TEMİZ
T3 sözleşme izi  : vmIdleTimeout=-1 (2 dosya) · InstanceName (2) · npm install (2)
                   utf-16-le (2) · base64 (3) · MISS≠PASS (3)
```
⚠ **Henüz koşulmadı:** idempotency testi (script'in mevcut `rtx-worker` üzerinde yeniden
koşulup hiçbir şeyi değiştirmediğinin kanıtı) ve kapı-dürüstlüğü testi (kasten bozulan fazın
kırmızı vermesi). Standart bunları "yapıldı" saymaz.

---

## C. Henüz DOĞRULANMAMIŞ (dürüstlük bölümü)

Bu adımlar tasarlandı ama `rtx-worker`'da **uçtan uca kanıtlanmadı** — standart onları
"yapıldı" saymaz:

| Konu | Durum |
|---|---|
| `ollamas remote dispatch` → worker | ❌ Son test: `worker:"gemini-cli"` · `failedOver:true` · `fetch failed`. Üç kod gerçeği: `probeBackend` yalnız Ollama'yı tanıyor (`/api/version` ollamas server'da yok → SPA fallback → 500); `assignWorker` yerel provider'ı seçiyor; varsayılan port iki tarafta da `8090` varsayılıyor (kontrol makinesinde server `:3000`). **Kod değişikliği gerekiyor.** |
| Vault senkronu (tek-yazar) | ⬜ kurulmadı |
| eCym pipeline'ın uzakta koşumu + Mac/worker p95 karşılaştırması | ⬜ ölçülmedi |
| Reboot sonrası tam otomatik ayağa kalkma | 🔶 kısmi: Ollama boot görevi ve keepalive kurulu, **bütün zincir reboot'la sınanmadı** |
| Pil sağlığı (7/24 şarj) | ⬜ şarj limiti üretici aracı ister; yalnız raporlanıyor |
