import { useId } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { Icon } from './Icons.jsx';
import { nav, useNav } from '../lib/nav.js';

export const spring = { type: 'spring', stiffness: 420, damping: 40, mass: 0.9 };
export const softSpring = { type: 'spring', stiffness: 260, damping: 30 };

export function Button({ variant = 'primary', size, block, className = '', children, ...props }) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} transition={{ duration: 0.12 }}
      className={`btn btn-${variant} ${size ?? ''} ${block ? 'block' : ''} ${className}`} {...props}>
      {children}
    </motion.button>
  );
}

export function IconButton({ icon, filled, size = 22, label, ...props }) {
  return (
    <motion.button type="button" whileTap={{ scale: 0.9 }} className={`icon-btn ${filled ? 'filled' : ''}`} aria-label={label} {...props}>
      <Icon name={icon} size={size} />
    </motion.button>
  );
}

export function Pressable({ as = 'button', className = '', children, ...props }) {
  const C = motion[as];
  return <C whileTap={{ scale: 0.985 }} transition={{ duration: 0.12 }} className={className} {...props}>{children}</C>;
}

export function Segmented({ options, value, onChange, light }) {
  const id = useId();
  return (
    <div className={`seg ${light ? 'light' : ''}`} role="tablist">
      {options.map(o => (
        <button type="button" key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="thumb" transition={spring} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <motion.span className="knob" animate={{ x: on ? 20 : 0 }} transition={spring} />
    </button>
  );
}

export function Ring({ value, size = 96, stroke = 8, color = 'var(--pri)', track = 'var(--line)', children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} />
      </svg>
      <div className="center" style={{ position: 'absolute', inset: 0, flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

export function Tag({ tone = 'grey', children, icon }) {
  return <span className={`tag ${tone}`}>{icon && <Icon name={icon} size={12} stroke={2.2} />}{children}</span>;
}

export function TopBar({ title, onBack, backIcon = 'chevronLeft', right }) {
  return (
    <div className="topbar">
      {onBack ? <IconButton icon={backIcon} onClick={onBack} label="Back" /> : <span className="spacer" />}
      <div className="title ellipsis">{title}</div>
      {right ?? <span className="spacer" />}
    </div>
  );
}

export function OptionGrid({ options, value, onChange, columns }) {
  return (
    <div className="options" style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, 1fr)` }}>
      {options.map(o => (
        <motion.button type="button" key={o.value} whileTap={{ scale: 0.96 }} className={`opt ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          <span>{o.label}</span>
          {o.sub && <span className="opt-sub">{o.sub}</span>}
        </motion.button>
      ))}
    </div>
  );
}

/** Draw-on check mark used on completion moments. */
export function CheckBurst({ size = 88, tone = 'var(--pri)' }) {
  return (
    <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}
      style={{ width: size, height: size, borderRadius: '50%', background: tone, display: 'grid', placeItems: 'center', boxShadow: `0 12px 30px -12px ${tone}` }}>
      <svg width={size * 0.46} height={size * 0.46} viewBox="0 0 24 24" fill="none" stroke="var(--pri-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="m5 12.5 4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.45, ease: 'easeOut' }} />
      </svg>
    </motion.div>
  );
}

export function SheetHost() {
  const { sheet } = useNav();
  const controls = useDragControls();
  return (
    <AnimatePresence>
      {sheet && (
        <motion.div key={sheet.id} style={{ position: 'absolute', inset: 0, zIndex: 50 }} initial="hidden" animate="shown" exit="hidden">
          <motion.div className="backdrop" variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }} transition={{ duration: 0.22 }} onClick={() => nav.closeSheet()} />
          <motion.div className="sheet" role="dialog" variants={{ hidden: { y: '100%' }, shown: { y: 0 } }} transition={spring}
            drag="y" dragListener={false} dragControls={controls} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.05, bottom: 0.7 }}
            onDragEnd={(e, info) => (info.offset.y > 90 || info.velocity.y > 500) && nav.closeSheet()}>
            <div onPointerDown={e => controls.start(e)} style={{ touchAction: 'none', paddingBottom: 2 }}><div className="grabber" /></div>
            <div className="sheet-body">{sheet.render(() => nav.closeSheet())}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ToastHost() {
  const { toasts } = useNav();
  return (
    <div className="toast-wrap">
      <AnimatePresence>
        {toasts.slice(-1).map(t => (
          <motion.div key={t.id} className="toast" initial={{ y: -30, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -20, opacity: 0 }} transition={spring}>
            <Icon name={t.icon} size={18} stroke={2.2} />{t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Confirmation inside a sheet. */
export function confirmSheet({ title, body, confirm, tone = 'danger', onConfirm, onCancel, cancel = 'Cancel', extra }) {
  nav.openSheet(close => (
    <div className="stack gap-12" style={{ paddingBottom: 4 }}>
      <h2>{title}</h2>
      {body && <p className="sub" style={{ margin: 0 }}>{body}</p>}
      <div className="stack gap-8" style={{ marginTop: 8 }}>
        {extra}
        <Button variant={tone} size="lg" block onClick={() => { close(); setTimeout(onConfirm, 60); }}>{confirm}</Button>
        <Button variant="secondary" size="lg" block onClick={() => { close(); if (onCancel) setTimeout(onCancel, 60); }}>{cancel}</Button>
      </div>
    </div>
  ));
}

export function Stagger({ children, delay = 0.035, className, style }) {
  return (
    <motion.div className={className} style={style} initial="hidden" animate="shown" variants={{ shown: { transition: { staggerChildren: delay } } }}>
      {children}
    </motion.div>
  );
}
export const staggerItem = { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0, transition: softSpring } };
