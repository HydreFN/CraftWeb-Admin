import { auth } from "@/lib/auth";

// Better Auth expose un handler standard (Request → Response).
// Instanciation paresseuse pour que `next build` passe sans .env complet.
export async function GET(request: Request) {
  return auth().handler(request);
}

export async function POST(request: Request) {
  return auth().handler(request);
}
