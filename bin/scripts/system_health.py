import platform
import psutil

def get_health():
    return {
        "os": platform.system(),
        "cpu": psutil.cpu_percent(),
        "memory": psutil.virtual_memory().percent,
        "status": "healthy"
    }

if __name__ == "__main__":
    print(get_health())
