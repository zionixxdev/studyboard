import { useEffect, useRef, useState, type Ref } from 'react';
import 'mathlive';
import JXG from 'jsxgraph';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { GlassInput } from '@/components/ui/GlassInput';
import { cn } from '@/lib/utils';
import type { useRoomRealtime } from '@/hooks/useRoomRealtime';

interface MathfieldElement extends HTMLElement {
  value: string;
}

type Tab = 'equation' | 'plot';

export default function MathPanel({
  realtime,
}: {
  realtime: ReturnType<typeof useRoomRealtime>;
}) {
  const [tab, setTab] = useState<Tab>('equation');

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(['equation', 'plot'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'focus-ring pill px-4 py-2 text-sm capitalize',
              tab === t ? 'bg-accent/25 text-ink' : 'glass-subtle text-soft hover:text-ink',
            )}
          >
            {t === 'equation' ? 'Equation editor' : 'Coordinate graph'}
          </button>
        ))}
      </div>

      {tab === 'equation' ? <EquationEditor realtime={realtime} /> : <Plotter />}
    </div>
  );
}

/** MathLive-powered equation editor. Inserts the LaTeX onto the whiteboard. */
function EquationEditor({ realtime }: { realtime: ReturnType<typeof useRoomRealtime> }) {
  const mfRef = useRef<MathfieldElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function insert() {
    const latex = mfRef.current?.value?.trim();
    if (!latex) {
      setStatus('Type an equation first.');
      return;
    }
    // Placed near the top-left of the board; drag is not implemented on canvas
    // text (see docs/LIMITATIONS.md).
    realtime.broadcast({
      type: 'whiteboard:op',
      op: { kind: 'formula', x: 60, y: 60, latex },
      sender: '',
    });
    setStatus('Inserted onto the whiteboard.');
    setTimeout(() => setStatus(null), 2000);
  }

  return (
    <GlassCard className="space-y-4 p-5">
      <div>
        <h3 className="font-semibold text-ink">Equation editor</h3>
        <p className="text-sm text-soft">
          Type or use the virtual keyboard, then insert the formula onto the shared whiteboard.
        </p>
      </div>

      <div className="rounded-2xl glass-subtle p-3 text-ink">
        {/* MathLive custom element */}
        <math-field
          ref={mfRef as unknown as Ref<HTMLElement>}
          virtual-keyboard-mode="manual"
          style={{ width: '100%', fontSize: '1.35rem', background: 'transparent', color: 'inherit', border: 'none' }}
        >
          x^2 + \frac&#123;a&#125;&#123;b&#125;
        </math-field>
      </div>

      <div className="flex items-center gap-3">
        <GlassButton onClick={insert}>Insert onto whiteboard</GlassButton>
        <GlassButton
          variant="subtle"
          onClick={() => {
            if (mfRef.current) mfRef.current.value = '';
          }}
        >
          Clear
        </GlassButton>
        {status && <span className="text-xs text-soft">{status}</span>}
      </div>

      <p className="text-xs text-faint">
        The whiteboard renders formulas as their LaTeX source; this editor shows the typeset form.
      </p>
    </GlassCard>
  );
}

/** JSXGraph coordinate plane with a function plotter. */
function Plotter() {
  const boxRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<JXG.Board | null>(null);
  const [expr, setExpr] = useState('x^2 - 2');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!boxRef.current || boardRef.current) return;
    boardRef.current = JXG.JSXGraph.initBoard(boxRef.current, {
      boundingbox: [-8, 8, 8, -8],
      axis: true,
      grid: true,
      showNavigation: true,
      showCopyright: false,
      keepAspectRatio: true,
    });
    return () => {
      JXG.JSXGraph.freeBoard(boardRef.current!);
      boardRef.current = null;
    };
  }, []);

  function plot() {
    setError(null);
    const board = boardRef.current;
    if (!board) return;

    // Compile the expression. This is evaluated only in the local user's browser
    // on their own input; it is never sent to the server. It is still a
    // deliberate eval — do not paste untrusted expressions.
    let fn: (x: number) => number;
    try {
      const normalized = expr.replace(/\^/g, '**');
      // eslint-disable-next-line no-new-func
      const compiled = new Function('x', `with (Math) { return (${normalized}); }`);
      fn = (x: number) => {
        const v = compiled(x);
        return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
      };
    } catch {
      setError('Could not parse that expression.');
      return;
    }

    try {
      board.create('functiongraph', [fn, -8, 8], { strokeColor: '#7a86ff', strokeWidth: 2 });
    } catch {
      setError('Could not plot that function.');
    }
  }

  function addCircle() {
    const board = boardRef.current;
    if (!board) return;
    board.create('circle', [
      [0, 0],
      [3, 0],
    ], { strokeColor: '#48d69c', strokeWidth: 2 });
  }

  function addLine() {
    const board = boardRef.current;
    if (!board) return;
    board.create('line', [
      [0, 0],
      [2, 3],
    ], { strokeColor: '#ffd166', strokeWidth: 2 });
  }

  return (
    <GlassCard className="space-y-4 p-5">
      <div>
        <h3 className="font-semibold text-ink">Coordinate plane</h3>
        <p className="text-sm text-soft">
          Plot a function of x, or add geometry to explore. Drag points to move them.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <GlassInput
            label="f(x) ="
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="e.g. sin(x) + x/3"
          />
        </div>
        <GlassButton onClick={plot}>Plot</GlassButton>
        <GlassButton variant="subtle" onClick={addCircle}>
          Add circle
        </GlassButton>
        <GlassButton variant="subtle" onClick={addLine}>
          Add line
        </GlassButton>
        <GlassButton
          variant="subtle"
          onClick={() => {
            const board = boardRef.current;
            if (!board) return;
            const elements = Object.values(board.objects) as JXG.GeometryElement[];
            for (const el of elements) {
              if (el.elType === 'functiongraph' || el.elType === 'circle' || el.elType === 'line') {
                board.removeObject(el);
              }
            }
          }}
        >
          Clear
        </GlassButton>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div ref={boxRef} className="jxgbox h-[45vh] w-full rounded-2xl glass-subtle" style={{ aspectRatio: 'auto' }} />
    </GlassCard>
  );
}
