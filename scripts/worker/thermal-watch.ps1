# thermal-watch.ps1 — worker donanim bekcisi (WORKER-STANDARD.md Faz 6)
#
# Hedef makinede C:\ecy\worker\ altinda durur, Task Scheduler 60 sn'de bir kosar.
#
# KURAL Y-4 (bu makinede olculerek ogrenildi): MSAcpi_ThermalZoneTemperature'i
# `Select-Object -First 1` ile okumak YANLISTIR — her cagride farkli bolge donebilir ve
# sahte alarm uretir (bosta 89 C goruldu, gercek 59-67 C). Bolgeler InstanceName ile
# adlandirilarak okunur ve MAKSIMUM alinir.
#
# KURAL MISS != PASS: sicaklik OLCULEMIYORSA is bindirilmez -> PAUSE bayragi yazilir.

$log   = "C:\ecy\worker\thermal.log"
$pause = "C:\ecy\worker\PAUSE"
$WARN  = 85     # uyari esigi
$STOP  = 95     # duraklatma esigi (olculen kritik noktalar 114/125 — guvenli marj)

# SSD omru: log 5 MB'i gecince devret (disk verimliligi direktifi)
if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item $log "$log.1" -Force }

$zones  = Get-CimInstance -Namespace "root/wmi" -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue
$maxC   = -1
$detail = @()
foreach ($z in $zones) {
  $c = [math]::Round(($z.CurrentTemperature - 2732) / 10, 1)
  $detail += ($z.InstanceName.Split('\')[-1] + "=" + $c)
  if ($c -gt $maxC) { $maxC = $c }
}

$gpu = (& nvidia-smi --query-gpu=temperature.gpu,power.draw,utilization.gpu --format=csv,noheader 2>$null)
$ts  = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if ($maxC -lt 0) {
  Add-Content $log "$ts cpu=OLCULEMEDI gpu=$gpu durum=PAUSE-olcum-yok"
  Set-Content $pause "sicaklik olculemedi $ts"
}
elseif ($maxC -gt $STOP) {
  Add-Content $log "$ts cpu_max=$maxC ($($detail -join ' ')) gpu=$gpu durum=PAUSE-sicak"
  Set-Content $pause "cpu $maxC C > $STOP esigi $ts"
}
else {
  $d = if ($maxC -gt $WARN) { "UYARI" } else { "OK" }
  Add-Content $log "$ts cpu_max=$maxC ($($detail -join ' ')) gpu=$gpu durum=$d"
  if (Test-Path $pause) { Remove-Item $pause -Force }   # sogudu -> is geri akar
}
