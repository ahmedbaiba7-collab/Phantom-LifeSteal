'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** The single most-used control on any server site. It says what it does, and what it did. */
export function CopyIp({ ip, className = '' }: { ip: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(ip);
    } catch {
      // Clipboard is blocked in some embedded browsers; select-and-copy still works.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy server address ${ip}`}
      className={`group flex items-center gap-3 rounded-xl border border-edge bg-void/60 px-4 py-3
                  font-mono text-sm text-ink transition-colors hover:border-neon/50 hover:bg-neon/5 ${className}`}
    >
      <span className="tabular">{ip}</span>
      <span className="flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-widest text-neon">
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}
