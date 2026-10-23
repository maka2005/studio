const P = (d: string) => (p: { size?: number }) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>);
export const Arrow = P('M7 17L17 7M8 7h9v9');
export const ArrowRight = P('M5 12h14M13 6l6 6-6 6');
export const ArrowLeft = P('M19 12H5M11 6l-6 6 6 6');
export const Home = P('M3 11l9-8 9 8M5 10v10h14V10');
export const Grid = P('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z');
export const Calendar = P('M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4');
export const Sparkle = P('M12 3l2 6 6 3-6 3-2 6-2-6-6-3 6-3z');
export const Pin = P('M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12zM10 9a2 2 0 104 0 2 2 0 10-4 0');
export const Clock = P('M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2');
export const Phone = P('M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z');
export const Wrench = P('M14 6a4 4 0 005 5l-8 8a2.8 2.8 0 01-4-4l8-8z');
export const Photo = P('M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4');
export const Tag = P('M3 12V4h8l10 10-8 8z');
export const Download = P('M12 4v11M7 11l5 5 5-5M5 20h14');
export const User = P('M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0');
export const Close = P('M6 6l12 12M18 6L6 18');
