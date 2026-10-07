import type { Dataset } from './datasets';

/** Las librerías se cargan sólo al exportar (code splitting). */

export async function toXlsx(title: string, datasets: Dataset[], extraSheets: { name: string; lines: string[] }[] = []): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stock Manager';
  wb.title = title;
  for (const ds of datasets) {
    const ws = wb.addWorksheet(ds.title.slice(0, 31));
    ws.addRow(ds.columns);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
    ds.rows.forEach((r) => ws.addRow(r));
    ws.columns.forEach((col, i) => {
      const max = Math.max(ds.columns[i].length, ...ds.rows.slice(0, 500).map((r) => String(r[i] ?? '').length));
      col.width = Math.min(48, Math.max(10, max + 2));
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  for (const s of extraSheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    s.lines.forEach((l) => ws.addRow([l]));
    ws.getColumn(1).width = 110;
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function toPdf(title: string, datasets: Dataset[]): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Exportado: ${new Date().toLocaleString('es-AR')}`, 14, 22);
  let y = 28;
  for (const ds of datasets) {
    if (y > 180) {
      doc.addPage();
      y = 16;
    }
    doc.setFontSize(12);
    doc.setTextColor(30);
    doc.text(ds.title, 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [ds.columns],
      body: ds.rows.length ? ds.rows.map((r) => r.map((c) => String(c))) : [[`Sin datos`, ...ds.columns.slice(1).map(() => '')]],
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [79, 70, 229] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }
  return doc.output('blob');
}

export async function toDocx(title: string, datasets: Dataset[]): Promise<Blob> {
  const d = await import('docx');
  const cell = (text: string, bold = false) =>
    new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text, bold, size: 18 })] })] });
  const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [
    new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(title)] }),
    new d.Paragraph({ children: [new d.TextRun({ text: `Exportado: ${new Date().toLocaleString('es-AR')}`, italics: true, size: 18 })] }),
  ];
  for (const ds of datasets) {
    children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [new d.TextRun(ds.title)] }));
    if (!ds.rows.length) {
      children.push(new d.Paragraph('Sin datos.'));
      continue;
    }
    children.push(
      new d.Table({
        width: { size: 100, type: d.WidthType.PERCENTAGE },
        rows: [
          new d.TableRow({ tableHeader: true, children: ds.columns.map((c) => cell(c, true)) }),
          ...ds.rows.map((r) => new d.TableRow({ children: r.map((c) => cell(String(c))) })),
        ],
      }),
    );
  }
  const doc = new d.Document({
    creator: 'Stock Manager',
    title,
    sections: [{ properties: { page: { size: { orientation: d.PageOrientation.LANDSCAPE } } }, children }],
  });
  return d.Packer.toBlob(doc);
}

export function toJsonBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}
