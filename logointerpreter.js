// logoInterpreter.js

// Memory storage for variables
const variables = {};

export function setVariable(name, val) {
  // Strip quotes and convert string values to lowercase before saving to memory
  if (typeof val === 'string') {
    variables[name] = val.replace(/"/g, '').toLowerCase();
  } else {
    variables[name] = val;
  }
}

export function getVariable(name) {
  return variables[name];
}

function evaluateExpr(exprStr) {
  let substituted = String(exprStr).trim();
  if (!substituted) return 0;

  // 1. Resolve LOGO colon variables (e.g., :vowel -> "a", :a -> "a")
  substituted = substituted.replace(/:([a-zA-Z0-9_]+)/g, (match, varName) => {
    const key = Object.keys(variables).find(k => k.toLowerCase() === varName.toLowerCase());
    if (key) {
      const cleanVal = String(variables[key]).replace(/"/g, '').toLowerCase();
      return `"${cleanVal}"`;
    }
    // If undefined in variables (like :a), treat as literal string "a"
    return `"${varName.toLowerCase()}"`;
  });

  // 2. Resolve unquoted plain variable names (e.g., vowel -> "a")
  Object.keys(variables).forEach(varName => {
    const cleanVal = String(variables[varName]).replace(/"/g, '').toLowerCase();
    const regex = new RegExp(`(?<!["'a-zA-Z0-9_])\\b${varName}\\b(?!["'a-zA-Z0-9_])`, 'gi');
    substituted = substituted.replace(regex, `"${cleanVal}"`);
  });

  // 3. Resolve single-quoted LOGO literal strings (e.g., "blank -> "blank", "a -> "a")
  substituted = substituted.replace(/(^|[\s=<>!])"([a-zA-Z0-9_]+)(?!"|\w*")/g, '$1"$2"');

  // 4. Convert single LOGO '=' to JS '=='
  substituted = substituted.replace(/([^!=<>])=([^=])/g, '$1==$2');

  console.log(`🔍 [LOGO EVAL] Original: "${exprStr}" | Evaluated JS: ${substituted}`);
  console.log(`📌 [LOGO VARS] Active Memory:`, JSON.stringify(variables));

  try {
    const result = Function(`"use strict"; return (${substituted})`)();
    console.log(`✅ [LOGO EVAL RESULT] ->`, result);
    return result;
  } catch (err) {
    console.error("Expression evaluation error:", exprStr, "JS Attempt:", substituted, err);
    return 0;
  }
}

// Extract bracketed blocks
function extractBlock(tokens, startIndex) {
  let depth = 0;
  let blockTokens = [];
  let i = startIndex;

  if (tokens[i] !== '[') return { blockTokens: [], nextIndex: startIndex };

  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '[') {
      depth++;
      if (depth === 1) continue;
    } else if (token === ']') {
      depth--;
      if (depth === 0) return { blockTokens, nextIndex: i + 1 };
    }

    if (depth > 0) {
      blockTokens.push(token);
    }
  }
  return { blockTokens, nextIndex: i };
}

// Main recursive execution parser
export async function parseAndExecuteLOGO(programText, stepCallback) {
  Object.keys(variables).forEach(k => delete variables[k]);

  const openBrackets = (programText.match(/\[/g) || []).length; 
  const closeBrackets = (programText.match(/\]/g) || []).length;
  if (openBrackets !== closeBrackets) {
    throw new Error(`Syntax Error: Unmatched brackets ([${openBrackets}] vs ]${closeBrackets}]).`);
  }

  const tokens = programText
    .replace(/\[/g, ' [ ') .replace(/\]/g, ' ] ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);

  const VALID_KEYWORDS = [
    'make', 'while', 'repeat', 'ifelse', 
    'fd', 'bk', 
    'lt', 'rt', 
    '[', ']', 'vowel'
  ];

  // Pre-register all variable names declared via 'make'
  const declaredVars = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].toLowerCase() === 'make' && i + 1 < tokens.length) {
      const rawVar = tokens[i + 1].replace(/^"/, '').toLowerCase();
      declaredVars.add(rawVar);
    }
  }

  // Pre-pass validation
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const cmd = token.toLowerCase();

    const isKeyword = VALID_KEYWORDS.includes(cmd);
    const isNumber = !isNaN(Number(token));
    const isStringLiteral = token.startsWith('"') || token.endsWith('"');
    const isOperator = ['==', '=', '!=', '>', '<', '>=', '<=', '+', '-', '*', '/'].includes(cmd);
    const isVariableRef = token.startsWith(':');
    const isDeclaredVar = declaredVars.has(cmd.replace(/^"/, ''));
    const isMakeVar = i > 0 && tokens[i - 1].toLowerCase() === 'make';

    if (!isKeyword && !isNumber && !isStringLiteral && !isOperator && !isVariableRef && !isDeclaredVar && !isMakeVar) {
      throw new Error(`Syntax Error: Unrecognized command '${token}'.`);
    }
  }

  async function runTokens(tokenList) {
    let ptr = 0;

    while (ptr < tokenList.length) {
      const token = tokenList[ptr];
      const cmd = token.toLowerCase();

      // Runtime command validation
      const isKeyword = VALID_KEYWORDS.includes(cmd);
      const isNumber = !isNaN(Number(token));
      const isStringLiteral = token.startsWith('"') || token.endsWith('"');
      const isOperator = ['==', '=', '!=', '>', '<', '>=', '<=', '+', '-', '*', '/'].includes(cmd);
      const cleanCmd = cmd.replace(/^[:"]/, '');
      const isVariable = cleanCmd in variables || declaredVars.has(cleanCmd) || token.startsWith(':');

      if (!isKeyword && !isNumber && !isStringLiteral && !isOperator && !isVariable) {
        throw new Error(`Syntax Error: Unrecognized command '${token}'.`);
      }

      // MAKE command
      if (cmd === 'make') {
        const rawVarName = tokenList[ptr + 1];
        if (!rawVarName) throw new Error("Syntax Error: 'make' requires a variable name.");
        
        const varName = rawVarName.replace(/^"/, '');
        ptr += 2;
        
        let exprTokens = [];
        while (
          ptr < tokenList.length && 
          !VALID_KEYWORDS.includes(tokenList[ptr].toLowerCase())
        ) {
          exprTokens.push(tokenList[ptr]);
          ptr++;
        }
        
        const val = evaluateExpr(exprTokens.join(' '));
        // Save clean value into memory
        setVariable(varName, val);
        continue;
      }

      // REPEAT command
      if (cmd === 'repeat') {
        const countExpr = tokenList[ptr + 1];
        const times = evaluateExpr(countExpr);
        ptr += 2;

        const { blockTokens, nextIndex } = extractBlock(tokenList, ptr);
        ptr = nextIndex;

        for (let r = 0; r < times; r++) {
          await runTokens(blockTokens);
        }
        continue;
      }

      // WHILE command
      if (cmd === 'while') {
        ptr++;
        let exprTokens = [];
        while (ptr < tokenList.length && tokenList[ptr] !== '[') {
          exprTokens.push(tokenList[ptr]);
          ptr++;
        }
        const exprStr = exprTokens.join(' ');

        const { blockTokens, nextIndex } = extractBlock(tokenList, ptr);
        ptr = nextIndex;

        let maxGuard = 2000;
        while (evaluateExpr(exprStr) && maxGuard > 0) {
          const hitBorder = await runTokens(blockTokens);
          if (hitBorder) break;
          maxGuard--;
        }
        continue;
      }

      // IFELSE command
      if (cmd === 'ifelse') {
        ptr++;
        let exprTokens = [];
        while (ptr < tokenList.length && tokenList[ptr] !== '[') {
          exprTokens.push(tokenList[ptr]);
          ptr++;
        }
        const exprStr = exprTokens.join(' ');

        const trueBlock = extractBlock(tokenList, ptr);
        ptr = trueBlock.nextIndex;

        const falseBlock = extractBlock(tokenList, ptr);
        ptr = falseBlock.nextIndex;

        if (evaluateExpr(exprStr)) {
          await runTokens(trueBlock.blockTokens);
        } else {
          await runTokens(falseBlock.blockTokens);
        }
        continue;
      }

      // TURTLE MOTIONS
      if (['fd', 'bk', 'lt', 'rt'].includes(cmd)) {
        const val = evaluateExpr(tokenList[ptr + 1] || '1');
        const stepResult = await stepCallback(cmd, val);
        ptr += 2;
        if (stepResult === true) return true;
        continue;
      }

      ptr++;
    }
  }

  await runTokens(tokens);
}