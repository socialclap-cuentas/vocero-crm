import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

export const dynamic = "force-dynamic";

const MAX_QUESTION_LEN = 500;
const MAX_ANSWER_LEN = 4000;
const MAX_BLOCK_LEN = 8000;
const MAX_LINES = 500;

const importSchema = z.object({
  text: z.string().trim().min(1).max(200_000),
});

/**
 * Formato de importación, un renglón por entrada:
 *   pregunta | respuesta   -> se carga como par P/R
 *   cualquier otra línea   -> se carga como bloque de texto libre
 * Líneas vacías o que empiezan con "#" se ignoran.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, importSchema);
  if (!body.ok) return body.response;

  const lines = body.data.text.split(/\r?\n/).slice(0, MAX_LINES);

  type Insertable = {
    id: string;
    organizationId: string;
    kind: "qa" | "block";
    question: string | null;
    answer: string | null;
    content: string | null;
  };

  const toInsert: Insertable[] = [];
  let skipped = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const sepIdx = line.indexOf("|");
    if (sepIdx > -1) {
      const question = line.slice(0, sepIdx).trim();
      const answer = line.slice(sepIdx + 1).trim();
      if (!question || !answer || question.length > MAX_QUESTION_LEN || answer.length > MAX_ANSWER_LEN) {
        skipped++;
        continue;
      }
      toInsert.push({
        id: newId("kbEntry"),
        organizationId: session.organizationId,
        kind: "qa",
        question,
        answer,
        content: null,
      });
    } else {
      if (line.length > MAX_BLOCK_LEN) {
        skipped++;
        continue;
      }
      toInsert.push({
        id: newId("kbEntry"),
        organizationId: session.organizationId,
        kind: "block",
        question: null,
        answer: null,
        content: line,
      });
    }
  }

  if (toInsert.length === 0) {
    return apiError(400, "invalid", "No se encontraron entradas válidas en el archivo");
  }

  const db = getDb();
  const inserted = await db.insert(schema.kbEntry).values(toInsert).returning();

  return Response.json({ imported: inserted.length, skipped });
});
