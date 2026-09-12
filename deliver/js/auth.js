import { supabase } from "./shared.js";

export async function getSession() { const { data, error } = await supabase().auth.getSession(); if (error) throw error; return data.session; }
export async function signIn(email, password) {
  const { data, error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error("Sign-in succeeded but no session was returned. Confirm email verification is complete in Supabase Auth.");
  return data.session;
}
export async function signOut() { const { error } = await supabase().auth.signOut({ scope: "local" }); if (error) throw error; }
export function onAuthChange(callback) { return supabase().auth.onAuthStateChange((_event, session) => callback(session)); }
