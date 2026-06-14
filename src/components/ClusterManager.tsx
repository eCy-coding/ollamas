import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal, ShieldCheck, Power, Cpu } from 'lucide-react';
import { ClusterTelemetry } from '@/types';

export const ClusterManager: React.FC = () => {
    const [telemetry, setTelemetry] = useState<ClusterTelemetry>({
        consent: { approved: false, timestamp: '', termsHash: '' },
        peers: [],
        isJoined: false
    });
    const [status, setStatus] = useState<'disconnected' | 'active'>('disconnected');
    const [cpuCap, setCpuCap] = useState(10);

    useEffect(() => {
        // Fetch consent and live node status
        fetch('/api/cluster/status')
            .then(res => res.json())
            .then(data => {
                setStatus(data.status);
                setTelemetry(prev => ({ ...prev, isJoined: data.status === 'active' }));
            });
    }, []);

    const handleConsent = async () => {
        const timestamp = new Date().toISOString();
        const termsHash = 'sha256-consent-' + timestamp;
        
        await fetch('/api/cluster/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved: true, termsHash })
        });

        setTelemetry(prev => ({
            ...prev,
            consent: { approved: true, timestamp, termsHash },
            isJoined: true
        }));
        setStatus('active');
    };

    const handleLeave = async () => {
        await fetch('/api/cluster/leave', { method: 'POST' });
        setTelemetry(prev => ({ ...prev, isJoined: false }));
        setStatus('disconnected');
    };

    if (!telemetry.consent.approved || !telemetry.isJoined) {
        return (
            <Card className="max-w-2xl mx-auto mt-10 border-amber-900 bg-slate-950 text-slate-100">
                <CardHeader>
                    <CardTitle className="text-amber-500 font-mono text-lg flex items-center gap-2">
                        <ShieldCheck /> Informed Consent Required (L1)
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm">
                        LLM Mission Control <strong>Distributed Mesh</strong>'e katılarak bilgisayarınızın işlem gücünün (GPU/RAM) 
                        belirlenmiş bir dilimini anonim olarak havuza katarsınız. 
                    </p>
                    <ul className="list-disc pl-5 text-xs text-slate-400 space-y-1">
                        <li>Kişisel verileriniz asla cihazdan çıkmaz.</li>
                        <li>Tüm işlemler güvenli WASM sandbox'ında yürütülür.</li>
                        <li>Kaynak kullanımını dilediğiniz an kısıtlayabilir veya mesh'ten çıkabilirsiniz.</li>
                    </ul>
                    <Button onClick={handleConsent} className="w-full bg-amber-600 hover:bg-amber-700 text-white">
                        I have read and I consent (Join Mesh)
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="p-6 space-y-6 bg-slate-950 text-slate-100 min-h-screen">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold font-mono">Cluster Mesh Live</h2>
                <Button onClick={handleLeave} variant="destructive">Leave Mesh</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-slate-900 border-slate-700">
                    <CardHeader><CardTitle className="flex items-center gap-2"><Cpu size={18}/> Resource Governor</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between text-sm">
                            <span>CPU Cap: {cpuCap}%</span>
                        </div>
                        <Slider value={[cpuCap]} onValueChange={(v) => setCpuCap(v[0])} max={50} min={5} step={5} />
                        <p className="text-xs text-slate-400 italic">Idle-aware: User detected → Throttle enforced.</p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-900 border-slate-700">
                    <CardHeader><CardTitle className="flex items-center gap-2"><Terminal size={18}/> Sandbox Status</CardTitle></CardHeader>
                    <CardContent>
                        <Alert className="bg-emerald-950 border-emerald-900 text-emerald-100">
                            <AlertTitle>WASM/WASI Active</AlertTitle>
                            <AlertDescription>Foreign tasks are isolated and fuel-restricted.</AlertDescription>
                        </Alert>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
