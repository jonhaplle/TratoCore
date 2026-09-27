const ExcelJS = require("exceljs");

class MLTemplateService {

    constructor(templatePath) {
        this.templatePath = templatePath;
        this.workbook = new ExcelJS.Workbook();
    }

    async load() {

        await this.workbook.xlsx.readFile(this.templatePath);

    }

    getWorksheet(sheetName) {

        const sheet = this.workbook.getWorksheet(sheetName);

        if (!sheet) {
            throw new Error(`Aba "${sheetName}" não encontrada.`);
        }

        return sheet;

    }

    getHeaderMap(sheet) {

        const map = {};

        const headerRow = sheet.getRow(1);

        headerRow.eachCell((cell, colNumber) => {

            const name = String(cell.value || "").trim();

            if (name !== "") {

                map[name] = colNumber;

            }

        });

        return map;

    }

    findFirstEmptyRow(sheet) {

        let row = 2;

        while (true) {

            const current = sheet.getRow(row);

            let empty = true;

            current.eachCell(cell => {

                if (cell.value !== null && cell.value !== "") {

                    empty = false;

                }

            });

            if (empty)
                return row;

            row++;

        }

    }

    fillProduct(sheetName, product) {

        const sheet = this.getWorksheet(sheetName);

        const columns = this.getHeaderMap(sheet);

        const rowNumber = this.findFirstEmptyRow(sheet);

        const row = sheet.getRow(rowNumber);

        const set = (header, value) => {

            if (columns[header]) {

                row.getCell(columns[header]).value = value;

            }

        };

        set("Título", product.title);

        set("Preço", product.price);

        set("Preço [R$]", product.price);

        set("Marca", product.brand);

        set("Modelo", product.model);

        set("SKU", product.sku);

        set("Quantidade", product.stock);

        set("Estoque", product.stock);

        set("Descrição", product.description);

        set("Condição", product.condition);

        if (product.photos && product.photos.length) {

            set("Fotos", product.photos.join(","));

        }

        row.commit();

        return rowNumber;

    }

    async save(outputFile) {

        await this.workbook.xlsx.writeFile(outputFile);

    }

}

module.exports = MLTemplateService;