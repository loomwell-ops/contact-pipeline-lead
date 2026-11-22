// Edit this file per client. Only the public anon key goes here, never the service_role key.
window.CRM_CONFIG = {
  businessName: "Loomwell Ops",
  accent: "#4b3fd6",
  supabaseUrl: "https://daxftvwilzdtkxcsbtxz.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheGZ0dndpbHpkdGt4Y3NidHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUyNzY2NTUsImV4cCI6MjExMDg1MjY1NX0.ZbeeTm3JbkXesMM2SDTbSwDOyrfqCSP7GDnPQI8KjcI",
  // Switch modules on or off per client. "forms" needs "crm". Remove a module's script tag in index.html too to leave its code out.
  modules: ["crm", "forms"],
  defaultStages: ["New Lead", "Contacted", "Qualified", "Proposal", "Won", "Lost"]
};
