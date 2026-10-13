import { getState } from "../../../lib/chain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getState());
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
