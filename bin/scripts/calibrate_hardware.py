import platform
import psutil
import torch

def detect_hardware():
    # Detect basic OS/Arch
    info = {
        "os": platform.system(),
        "arch": platform.machine(),
        "cpu_count": psutil.cpu_count(logical=True),
        "total_memory_gb": round(psutil.virtual_memory().total / (1024**3), 2),
        "gpu_available": torch.cuda.is_available() if 'torch' in sys.modules else False
    }                
    
    # MBP M4 Pro Max specific heuristics
    if info["cpu_count"] >= 16 and "arm" in info["arch"].lower():
        info["device_profile"] = "Apple_Silicon_High_Performance"
    else:
        info["device_profile"] = "Standard"
        
    return info

if __name__ == "__main__":
    import sys
    print(detect_hardware())
