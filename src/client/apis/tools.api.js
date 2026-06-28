const BASE = '';

export async function fetchTools() {
  const res = await fetch(`${BASE}/api/tools`);
  if (!res.ok) throw new Error('Failed to fetch tools');
  return res.json();
}
