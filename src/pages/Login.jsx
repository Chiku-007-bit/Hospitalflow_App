import { useState } from 'react';
import { Activity, ShieldCheck } from 'lucide-react';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onLogin(email, password); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <main className="login-screen"><form className="login-card" onSubmit={submit}>
    <div className="login-brand"><span className="brand-mark"><Activity size={20}/></span><span>careflow</span></div>
    <p className="eyebrow">HOSPITAL WORKSPACE</p><h1>Sign in to your account</h1><p className="login-copy">Use the account provided by your hospital administrator.</p>
    <label>Email address<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
    <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button login-submit" disabled={busy}>{busy?'Signing in...':'Sign in'}</button>
    <p className="login-secure"><ShieldCheck size={15}/> Staff access only</p>
  </form></main>;
}
