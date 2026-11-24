const $ = id => document.getElementById(id);
let mode = 'login';

$('switch').onclick = () => {
  mode = mode === 'login' ? 'register' : 'login';
  const reg = mode === 'register';
  $('subtitle').textContent = reg ? 'Create an account to start your journal.' : 'Welcome back. Log in to see your entries.';
  $('submit').textContent = reg ? 'Create account' : 'Log in';
  $('switchText').textContent = reg ? 'Already have an account?' : 'No account yet?';
  $('switch').textContent = reg ? 'Log in' : 'Create one';
  $('password').autocomplete = reg ? 'new-password' : 'current-password';
  $('pwhint').hidden = !reg;
  $('error').textContent = '';
};

$('form').onsubmit = async ev => {
  ev.preventDefault();
  const email = $('email').value.trim(), password = $('password').value;
  if (!email || !password) return $('error').textContent = 'Please enter your email and password.';
  if (mode === 'register' && password.length < 8) return $('error').textContent = 'Password must be at least 8 characters.';

  $('submit').disabled = true;
  $('error').textContent = '';
  try {
    const res = await fetch(mode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return location.replace('/');
    const body = await res.json().catch(() => ({}));
    $('error').textContent = typeof body.detail === 'string' ? body.detail
      : res.status === 422 ? 'Please enter a valid email and a password of at least 8 characters.'
      : 'Something went wrong. Please try again.';
  } catch {
    $('error').textContent = 'Could not reach the server. Is it running?';
  } finally {
    $('submit').disabled = false;
  }
};
