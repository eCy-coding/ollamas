
import { DesktopCommander } from './commander';

export class SystemDiagnostic {
    public static async calibrateForM4() {
        console.log("Running hardware calibration for M4 Pro Max...");
        try {
            const rawOutput = await DesktopCommander.execute('python3', ['calibrate_hardware.py']);
            const result = JSON.parse(rawOutput.replace(/'/g, '"'));
            
            console.log("System calibrated:", result);
            return result;
        } catch (e) {
            console.error("Calibration failed, using default settings.", e);
            return { profile: "Standard" };
        }
    }
}
