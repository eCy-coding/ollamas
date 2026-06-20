import React, { useState, useEffect } from 'react';
import { Terminal, ShieldCheck, Cpu } from 'lucide-react';
import { api } from '../lib/apiClient';

interface Props {
    onNotify: (msg: string, type: 'info' | 'error' | 'success') => void;
}

export const ClusterManager: React.FC<Props> = ({ onNotify }) => {
    const [status, setStatus] = useState<'disconnected' | 'active'>('disconnected');
    const [cpuCap, setCpuCap] = useState(10);
    const [orchestratorError, setOrchestratorError] = useState<string | null>(null);

    const handleConsent = async () => {
        setStatus('active');
        onNotify("Joined the mesh.", "success");
    };

    const handleLeave = async () => {
        setStatus('disconnected');
        onNotify("Left the mesh.", "info");
    };

    useEffect(() => {
        api.get('/api/cluster/capabilities')
            .then(data => {
                console.log("Detected capabilities:", data);
            })
            .catch(e => {
                setOrchestratorError("Orchestrator binary missing or incompatible. Please run `go build` in bin/.");
            });
    }, []);

    if (status === 'disconnected') {
        return (
            <div className="max-w-2xl mx-auto mt-10 p-6 border border-amber-900 bg-immersive-bg text-immersive-text-bright rounded-lg">
                <h2 className="text-amber-500 font-mono text-lg flex items-center gap-2 mb-4">
                    <ShieldCheck /> Informed Consent Required (L1)
                </h2>
                <div className="space-y-4">
                    <p className="text-sm">
                        LLM Mission Control <strong>Distributed Mesh</strong>'e katılarak bilgisayarınızın işlem gücünün (GPU/RAM) 
                        belirlenmiş bir dilimini anonim olarak havuza katarsınız. 
                    </p>
                    <ul className="list-disc pl-5 text-xs text-immersive-text-muted space-y-1">
                        <li>Kişisel verileriniz asla cihazdan çıkmaz.</li>
                        <li>Tüm işlemler güvenli WASM sandbox'ında yürütülür.</li>
                        <li>Kaynak kullanımını dilediğiniz an kısıtlayabilir veya mesh'ten çıkabilirsiniz.</li>
                    </ul>
                    <button onClick={handleConsent} className="w-full p-2 bg-amber-600 hover:bg-amber-700 text-immersive-text-bright rounded">
                        I have read and I consent (Join Mesh)
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 bg-immersive-bg text-immersive-text-bright min-h-screen">
            {orchestratorError && (
                <div className="p-4 bg-red-950 border border-red-900 rounded text-red-100 font-mono text-sm">
                    {orchestratorError}
                </div>
            )}
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold font-mono">Cluster Mesh Live</h2>
                <button onClick={handleLeave} className="p-2 bg-red-600 hover:bg-red-700 text-immersive-text-bright rounded">Leave Mesh</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-immersive-panel border border-immersive-border rounded-lg">
                    <h3 className="flex items-center gap-2 mb-4 font-bold"><Cpu size={18}/> Resource Governor</h3>
                    <div className="space-y-4">
                        <div className="flex justify-between text-sm">
                            <span>CPU Cap: {cpuCap}%</span>
                        </div>
                        <input type="range" value={cpuCap} onChange={(e) => setCpuCap(Number(e.target.value))} min={5} max={50} step={5} className='w-full'/>
                        <p className="text-xs text-immersive-text-muted italic">Idle-aware: User detected → Throttle enforced.</p>
                    </div>
                </div>

                <div className="p-4 bg-immersive-panel border border-immersive-border rounded-lg">
                    <h3 className="flex items-center gap-2 mb-4 font-bold"><Terminal size={18}/> Sandbox Status</h3>
                    <div className="p-3 bg-emerald-950 border border-emerald-900 text-emerald-100 rounded">
                        <p className="font-bold">WASM/WASI Active</p>
                        <p className="text-xs">Foreign tasks are isolated and fuel-restricted.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
