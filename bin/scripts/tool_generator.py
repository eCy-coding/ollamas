import sys

script_name = sys.argv[1]
with open(f"bin/scripts/{script_name}.py", "w") as f:
    f.write(f"print('Execution for {script_name}')")
print(f"Created {script_name}.py")
