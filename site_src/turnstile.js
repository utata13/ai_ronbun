// ロボット確認（Turnstile）の結果を画面に出す。Turnstile 本体より先に読み込む
const tsEn = document.documentElement.lang === 'en';
window.tsError = (code) => {
  const s = document.getElementById('status');
  if (s) {
    s.textContent = tsEn
      ? `The robot check failed (${code}). Please reload the page.`
      : `ロボット確認でエラーが起きました（${code}）。ページを読み込み直してください。`;
    s.classList.add('error');
  }
  return true;
};
window.tsExpired = () => {
  const s = document.getElementById('status');
  if (s) {
    s.textContent = tsEn
      ? 'The robot check expired. Please tick it again.'
      : 'ロボット確認の期限が切れました。もう一度チェックを入れてください。';
    s.classList.add('error');
  }
};
window.tsOk = () => {
  const s = document.getElementById('status');
  if (s && s.classList.contains('error')) {
    s.textContent = '';
    s.classList.remove('error');
  }
};
window.tsToken = () => document.querySelector('[name=cf-turnstile-response]')?.value || '';
