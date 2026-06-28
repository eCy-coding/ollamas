import React, { useState } from 'react';
import { InputEvent } from '../types';
import { api } from '../lib/apiClient';

export const VirtualController = () => {
    const [action, setAction] = useState<string>('');

    const sendAction = async (type: InputEvent['type'], payload: InputEvent['payload']) => {
        setAction(`Sending ${type} event...`);
        try {
            const data = await api.post('/api/cluster/execute', {
                toolName: 'input_bridge',
                payload: { type, ...payload }
            });
            setAction(`Done: ${JSON.stringify(data)}`);
        } catch (e) {
            setAction(`Error sending input event: ${(e as Error)?.message || "unknown"}`);
        }
    };

    return (
        <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 dark:bg-immersive-sidebar dark:border-immersive-border">
            <h2 className="text-lg font-semibold mb-2 text-immersive-text-dim dark:text-immersive-text-bright">Virtual Controller</h2>
            <div className="flex gap-2 mb-2">
                <button 
                  onClick={() => sendAction('keyboard', { key: 'Enter' })}
                  className="px-4 py-2 bg-indigo-600 text-immersive-text-bright rounded text-xs font-mono font-bold uppercase tracking-widest hover:bg-indigo-500 transition"
                >
                    Press Enter
                </button>
                <button 
                  onClick={() => sendAction('mouse', { x: 100, y: 100 })}
                  className="px-4 py-2 bg-emerald-600 text-immersive-text-bright rounded text-xs font-mono font-bold uppercase tracking-widest hover:bg-emerald-500 transition"
                >
                    Click (100, 100)
                </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-immersive-text-muted font-mono italic">{action}</p>
        </div>
    );
};
