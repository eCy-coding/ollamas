# Cluster Mesh Binary Repository

Bu klasör, yerel makinenizde çalışacak Go/Rust tabanlı `hardware_orchestrator` binary'sini içerir.

## Derleme (macOS ARM64 / M4 Pro Max)
1. Go ile derleyin:
   ```bash
   cd bin
   go build -o hardware_orchestrator main.go
   ```
2. İzinleri verin:
   ```bash
   chmod +x hardware_orchestrator
   ```

## Binary İçeriği
- `hardware_orchestrator`: Cluster düğüm yönetimi ve inference sarmalayıcısı.
