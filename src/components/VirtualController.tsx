import React, { useState } from 'react';
import { InputEvent } from '../types';

export const VirtualController = () => {
    const [action, setAction] = useState<string>('');

    const sendAction = async (type: InputEvent['type'], payload: InputEvent['payload']) => {
        setAction(`Sending ${type} event...`);
        try {
            const res = await fetch('/api/cluster/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    toolName: 'input_bridge',
                    payload: { type, ...payload } 
                })
            });
            const data = await res.json();
            setAction(`Done: ${JSON.stringify(data)}`);
        } catch (e) {
            setAction('Error sending input event');
        }
    };

    return (
        <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 dark:bg-[#08090d] dark:border-white/5">
            <h2 className="text-lg font-semibold mb-2 text-slate-800 dark:text-slate-200">Virtual Controller</h2>
            <div className="flex gap-2 mb-2">
                <button 
                  onClick={() => sendAction('keyboard', { key: 'Enter' })}
                  className="px-4 py-2 bg-indigo-600 text-white rounded text-xs font-mono font-bold uppercase tracking-widest hover:bg-indigo-500 transition"
                >
                    Press Enter
                </button>
                <button 
                  onClick={() => sendAction('mouse', { x: 100, y: 100 })}
                  className="px-4 py-2 bg-emerald-600 text-white rounded text-xs font-mono font-bold uppercase tracking-widest hover:bg-emerald-500 transition"
                >
                    Click (100, 100)
                </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 font-mono italic">{action}</p>
        </div>
    );
};
