const r = await fetch('/api/hello');
document.getElementById('out').textContent = JSON.stringify(await r.json());
