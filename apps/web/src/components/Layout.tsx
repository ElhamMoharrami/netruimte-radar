import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, isOffline, type WiringReport } from '../api.js';

export default function Layout() {
  const [wiring, setWiring] = useState<WiringReport | null>(null);

  useEffect(() => {
    api.wiring().then(setWiring).catch(() => setWiring(null));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-radar-panel/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-8">
          <div>
            <div className="text-radar-accent text-xl font-semibold tracking-tight">
              Netruimte Radar
            </div>
            <div className="text-xs text-slate-400 -mt-0.5">
              Autonomous early warning for grid-constrained businesses
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {[
              { to: '/radar', label: 'Radar' },
              { to: '/opportunities', label: 'Opportunities' },
              { to: '/runs', label: 'Runs' },
              { to: '/demo', label: 'Demo' },
            ].map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded text-sm ${
                    isActive
                      ? 'bg-slate-800 text-radar-accent'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs">
            {isOffline() && (
              <WiringPill label="offline" value="fixtures" tone="warn" />
            )}
            {wiring && (
              <>
                <WiringPill
                  label="mode"
                  value={wiring.demoMode ? 'demo' : 'live'}
                  tone={wiring.demoMode ? 'warn' : 'ok'}
                />
                <WiringPill
                  label="ai"
                  value={wiring.aiProvider}
                  tone={wiring.aiProvider === 'rules' ? 'warn' : 'ok'}
                />
                <WiringPill label="extractor" value={wiring.extractor} tone="info" />
                <WiringPill label="sources" value={wiring.sourceProvider} tone="info" />
                <WiringPill
                  label="grid"
                  value={wiring.gridProvider}
                  tone={wiring.gridProvider === 'netbeheer-nl' ? 'ok' : 'warn'}
                />
                <WiringPill
                  label="automation"
                  value={wiring.automationProvider}
                  tone={wiring.automationProvider === 'n8n' ? 'ok' : 'warn'}
                />
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-800 text-center text-xs text-slate-500 py-3">
        All extracted claims are provenance-linked. Grid congestion is demo data — never treated as
        verified topology.
      </footer>
    </div>
  );
}

function WiringPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'info';
}) {
  const toneClass =
    tone === 'ok'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800'
      : tone === 'warn'
        ? 'bg-amber-900/40 text-amber-300 border-amber-800'
        : 'bg-slate-800 text-slate-300 border-slate-700';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${toneClass}`}>
      <span className="text-slate-400 uppercase text-[10px]">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}
