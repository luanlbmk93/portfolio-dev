import * as XLSX from "xlsx";
import { getFirstName, formatPhoneForWhatsApp, type Lead } from "./utils";

function findColumn(
  headers: string[],
  candidates: string[],
): number {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate.toLowerCase());
    if (index !== -1) return index;
  }
  return -1;
}

export function parseLeadsFromFile(file: File): Promise<Lead[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        if (!data) {
          reject(new Error("Não foi possível ler o arquivo."));
          return;
        }

        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
        }) as unknown[][];

        if (rows.length < 2) {
          reject(new Error("O arquivo está vazio ou sem dados."));
          return;
        }

        const headers = rows[0].map((cell) => String(cell ?? "").trim());
        const nameIndex = findColumn(headers, [
          "nome lead",
          "nome",
          "name",
          "lead",
        ]);
        const phoneIndex = findColumn(headers, [
          "telefone",
          "phone",
          "celular",
          "whatsapp",
          "fone",
        ]);
        const emailIndex = findColumn(headers, ["email", "e-mail"]);

        if (nameIndex === -1) {
          reject(
            new Error('Coluna de nome não encontrada. Procure por "Nome Lead" ou "Nome".'),
          );
          return;
        }

        if (phoneIndex === -1) {
          reject(
            new Error(
              'Coluna de telefone não encontrada. Procure por "Telefone" ou "Celular".',
            ),
          );
          return;
        }

        const leads: Lead[] = [];
        const seenPhones = new Set<string>();

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const fullName = String(row[nameIndex] ?? "").trim();
          const phoneRaw = row[phoneIndex] as string | number | undefined;
          const email =
            emailIndex !== -1 ? String(row[emailIndex] ?? "").trim() : "";

          if (!fullName && phoneRaw == null) continue;

          const phone = formatPhoneForWhatsApp(phoneRaw ?? "");
          if (!phone || seenPhones.has(phone)) continue;

          seenPhones.add(phone);
          leads.push({
            id: leads.length + 1,
            fullName: fullName || "Sem nome",
            firstName: getFirstName(fullName || "Cliente"),
            phone,
            email,
          });
        }

        if (leads.length === 0) {
          reject(new Error("Nenhum lead válido encontrado no arquivo."));
          return;
        }

        resolve(leads);
      } catch {
        reject(new Error("Erro ao processar o arquivo Excel."));
      }
    };

    reader.onerror = () => reject(new Error("Erro ao ler o arquivo."));
    reader.readAsArrayBuffer(file);
  });
}
