/*
 * Browser storage, wrapped so a refusal never reaches the caller: Safari private mode
 * throws on access and a full quota throws on write, neither of which is worth failing
 * a table over. A read that cannot happen is indistinguishable from nothing stored.
 *
 *   store  localStorage  — survives a close: the player's name, hosted tables, the last code
 *   sess   sessionStorage — per browser TAB: this device's identity at the table
 */
export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k: string): void { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

export const sess = {
  get(k: string): string | null { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k: string, v: string): void { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};
