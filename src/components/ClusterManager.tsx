import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClusterTelemetry } from '@/types';

export const ClusterManager: React.FC = () => {
    const [telemetry, setTelemetry] = useState<ClusterTelemetry>({
        consent: { approved: false, timestamp: '', termsHash: '' },
        peers: [],
        isJoined: false
    });

    const handleConsent = () => {
        setTelemetry(prev => ({
            ...prev,
            consent: { approved: true, timestamp: new Date().toISOString(), termsHash: 'sha256-hash' },
            isJoined: true
        }));
    };

    if (!telemetry.isJoined) {
        return (
            <Card className="w-full max-w-2xl mx-auto mt-10 p-6 border-amber-500 bg-amber-50">
                <CardHeader>
                    <CardTitle className="text-amber-900">Distributed Mesh Setup</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="mb-4 text-amber-800">
                        Join the LLM Mission Control distributed swarm to contribute computational resources
                        and gain access to larger models.
                    </p>
                    <p className="mb-4 text-amber-800 font-semibold">Consent Required Before Joining.</p>
                    <Button onClick={handleConsent} className="bg-amber-600 hover:bg-amber-700">I have read and I consent</Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="p-6 space-y-6">
            <h2 className="text-2xl font-bold">Cluster Swarm Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader><CardTitle>Mesh Topology</CardTitle></CardHeader>
                    <CardContent>
                        <p>Status: Joined (Live)</p>
                        <p>Peers: {telemetry.peers.length}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Resources</CardTitle></CardHeader>
                    <CardContent>
                        <p>CPU Limit: 10% (Idle-Gov Active)</p>
                        <p>VRAM Lock: 8192 context</p>
                    </CardContent>
                </Card>
            </div>
            <Button variant="destructive">Leave Mesh</Button>
        </div>
    );
};
