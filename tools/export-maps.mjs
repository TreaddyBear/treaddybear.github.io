#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const configPath = path.resolve(option("--config", "src/config.ts"));
const outPath = path.resolve(option("--out", "map-exports/lawn-maps.json"));
const sourceText = fs.readFileSync(configPath, "utf8");
const source = ts.createSourceFile(configPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = new Map();
const evaluating = new Set();
const evaluated = new Map();

for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) {
    continue;
  }

  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
      declarations.set(declaration.name.text, declaration.initializer);
    }
  }
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  throw new Error(`Unsupported property name: ${name.getText(source)}`);
}

function numberFrom(node) {
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const value = Number(node.operand.text);
    if (node.operator === ts.SyntaxKind.MinusToken) {
      return -value;
    }
    if (node.operator === ts.SyntaxKind.PlusToken) {
      return value;
    }
  }

  throw new Error(`Expected number, got: ${node.getText(source)}`);
}

function evalIdentifier(name) {
  if (evaluated.has(name)) {
    return evaluated.get(name);
  }
  if (evaluating.has(name)) {
    throw new Error(`Circular config reference while evaluating ${name}`);
  }
  const initializer = declarations.get(name);
  if (!initializer) {
    throw new Error(`Unsupported identifier: ${name}`);
  }

  evaluating.add(name);
  const value = evalNode(initializer);
  evaluating.delete(name);
  evaluated.set(name, value);
  return value;
}

function evalNode(node) {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return evalNode(node.expression);
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isNumericLiteral(node) || ts.isPrefixUnaryExpression(node)) {
    return numberFrom(node);
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (ts.isIdentifier(node)) {
    return evalIdentifier(node.text);
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(evalNode);
  }

  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`Unsupported object property: ${property.getText(source)}`);
      }
      out[propertyName(property.name)] = evalNode(property.initializer);
    }
    return out;
  }

  if (ts.isNewExpression(node) && node.expression.getText(source).endsWith("Vector3")) {
    const values = (node.arguments ?? []).map(numberFrom);
    if (values.length !== 3) {
      throw new Error(`Vector3 needs 3 args: ${node.getText(source)}`);
    }
    return { x: values[0], y: values[1], z: values[2] };
  }

  throw new Error(`Unsupported expression: ${node.getText(source)}`);
}

const lawnLevels = evalIdentifier("lawnLevels");
const parSeconds = lawnLevels.settings?.parSeconds ?? {};
const maps = Object.entries(lawnLevels)
  .filter(([code]) => code !== "settings")
  .map(([code, map]) => {
    const exportedMap = {
      code: map.code ?? code,
      name: map.name,
      parSeconds: parSeconds[map.code ?? code],
      spawn: map.spawn,
      segments: map.segments,
      fenceSegments: map.fenceSegments,
      flowerBeds: map.flowerBeds,
      dandelionCount: map.dandelionCount,
    };

    if (map.flowerFields) {
      exportedMap.flowerFields = map.flowerFields;
    }
    if (map.cloverPatches) {
      exportedMap.cloverPatches = map.cloverPatches;
    }

    return exportedMap;
  });

const exportJson = {
  version: 0,
  maps,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(exportJson, null, 2)}\n`);
console.log(`Exported ${maps.length} maps to ${path.relative(process.cwd(), outPath)}`);
