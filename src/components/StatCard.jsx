import { ArrowUpRight, MoreHorizontal } from 'lucide-react';

export default function StatCard({ icon: Icon, tint, label, value, change, detail, neutral }) {
  return <article className="stat-card">
    <div className="stat-top"><span className={`stat-icon ${tint}`}><Icon size={18}/></span><button className="more-button" aria-label={`${label} options`}><MoreHorizontal size={18}/></button></div>
    <p>{label}</p><div className="stat-bottom"><strong>{value}</strong><span className={`stat-change ${neutral ? 'neutral' : ''}`}>{!neutral && <ArrowUpRight size={13}/>} {change}</span></div><small>{detail}</small>
  </article>;
}
