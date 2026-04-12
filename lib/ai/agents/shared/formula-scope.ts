/** Shared formula + repeat-scope rules used by Binding, styling, and workflows sub-agents.
 * This is the single source of truth for formula syntax and available functions.
 */

export const SHARED_FORMULA_SYNTAX = `## Formula Syntax

- Variable: \`variables['UUID']\`
- Data source: \`collections['UUID']?.data?.field\`
- Repeat item field: \`context?.item?.data?.field\`
- Nested repeat outer field: \`context?.item?.parent?.data?.field\`
- Primitive array value: \`context?.item?.data?.value\`
- Repeat index: \`context?.item?.data?.index\`
- \`.parent\` is ONLY valid inside an inner (nested) repeat template.
- Theme color in ternary: \`'theme:tokenName'\`
- Conventions: \`?.\` on all paths, \`not(value)\` for negation (never \`!\`), single quotes for strings \`'active'\`
- Equality: use \`===\` / \`!==\` directly, or \`equal(a, b)\` / \`notEqual(a, b)\` — never use \`==\` or \`!=\`
- Containment: use \`contains(str, substr)\` for string/array containment — never \`str.includes()\`
- Type conversion: \`toText(value)\` or \`string(value)\` for strings, \`toNumber(value)\` or \`number(value)\` for numbers
- String extraction: \`subText(str, start, end?)\` — NOT \`substring()\` (does not exist in the formula system)
- Node IDs and variable IDs are UUIDs — never invent them, only use IDs from prior results.

## Available Formula Functions

These are the ONLY callable functions. \`substring\`, \`parseInt\`, \`parseFloat\`, \`JSON.parse\` and method chaining (\`.split()\`, \`.toString()\`, \`.slice()\`) do NOT work in formula expressions. There is no expression evaluator — a formula like \`variables['UUID']\` returns the stored value as-is; math operators embedded inside a stored string (e.g. \`"5+3"\`) are never evaluated. Arithmetic must be performed on explicitly-known operand values using the functions above.

Conditional: \`if(cond,v1,v2)\`, \`ifEmpty(v,fallback)\`, \`not(v)\`, \`and(...)\`, \`or(...)\`, \`equal(a,b)\`, \`notEqual(a,b)\`, \`switch(expr,case1,res1,...,default)\` — cases matched via \`===\` against the runtime value of \`expr\`. \`if()\` is binary only (exactly 3 args); extra arguments are silently ignored. For 3+ cases use \`switch()\` to select a value. For branching with different step sequences per case, use a \`multiOptionBranch\` workflow step instead.
Math: \`toNumber(v)\`, \`abs(n)\`, \`ceil(n)\`, \`floor(n)\`, \`round(n,precision?)\`, \`max(...)\`, \`min(...)\`, \`clamp(n,lo,hi)\`, \`mod(a,b)\`, \`pow(base,exp)\`, \`sqrt(n)\`, \`sum(...)\`
Text: \`toText(v)\`, \`concat(...)\`, \`subText(str,start,end?)\`, \`split(str,sep)\`, \`join(arr,sep)\`, \`contains(str,sub)\`, \`indexOf(str,sub)\`, \`lower(s)\`, \`uppercase(s)\`, \`capitalize(s)\`, \`textLength(s)\`
Array: \`length(arr)\`, \`getByIndex(arr,i)\`, \`slice(arr,start,end?)\`, \`add(arr,...vals)\`, \`remove(arr,val)\`, \`merge(...arrs)\`, \`includes(arr,val)\`, \`findIndex(arr,val)\`, \`sort(arr,order?,key?)\`, \`map(arr,key)\`, \`filterByKey(arr,key,val)\`, \`distinct(arr)\`, \`flat(arr,depth?)\`, \`createArray(...)\`, \`toggleInArray(arr,val)\`, \`lookup(arr,val,key?)\`, \`prepend(arr,...vals)\`, \`removeByIndex(arr,i)\`, \`removeByKey(arr,key,val)\`, \`reverse(arr)\`, \`compare(a,b)\`
⚠️ \`add(arr,...vals)\` appends items to an array — it is NOT arithmetic addition. For math addition use the \`+\` operator directly: \`toNumber(a) + toNumber(b)\`.
Object: \`createObject(k1,v1,k2,v2,...)\`, \`getKeyValue(obj,key)\`, \`setKeyValue(obj,key,val)\`, \`keys(obj)\`, \`values(obj)\`, \`pick(obj,...keys)\`, \`omit(obj,...keys)\`
Formatting: \`formatCurrency(num,currencyCode?)\`
Validation: \`isEmpty(v)\`, \`isNotEmpty(v)\`, \`toBool(v)\`

Object literals: \`{ key: val }\` in a formula string does NOT create an object. Use \`createObject('key1', val1, 'key2', val2)\` to construct objects in formulas.

- For tool parameters (e.g. \`set_style\`, \`set_text\`, \`set_condition\`) — pass formula strings directly. The tool detects formulas automatically. Do NOT wrap in \`{ "formula": "..." }\` — just write the expression string as the value.
- Arithmetic and comparison operators (\`+\`, \`-\`, \`*\`, \`/\`, \`>\`, \`<\`, \`>=\`, \`<=\`) are valid in formula expressions — do not invent function names for them (e.g. use \`a - b\`, not \`minus(a, b)\`).

## set_repeat mapPath — Plain Dot Notation ONLY

When calling \`set_repeat\`, the \`mapPath\` argument MUST use plain dot notation:
- ✅ CORRECT: \`context.item.data.features\`
- ❌ WRONG: \`context?.item?.data?.features\`

Optional chaining in a \`mapPath\` breaks scope resolution — the \`context?\` prefix is not recognized as a scope variable, so the nested repeat never iterates and the list is always blank.

This is the ONLY place where optional chaining must NOT be used. All other formula strings (conditions, text bindings, etc.) still use \`?.\` as normal.

## Nested Repeat Patterns

When a UI has a loop inside a loop, use one of these patterns:

### Pattern A — sub-array field on each outer item
Data: ONE variable where each item has an array field.
Outer repeat: set_repeat(outerId, { mapPath: "variables['PLANS_UUID']" })
Inner repeat: set_repeat(innerId, { mapPath: "context.item.data.features", keyField: "index" })
  mapPath uses plain dot notation (no optional chaining) — see rule above.
  keyField: use "index" when the sub-array contains plain strings or numbers (no id field).
  keyField: use "id" only when sub-array items are objects that have an id field.
Inner text binding: context?.item?.data?.value  (for primitive string/number arrays)
  or: context?.item?.data?.fieldName  (for object arrays)
Outer field inside inner template: context?.item?.parent?.data?.name

### Pattern B — separate array-of-arrays variable
Data: TWO variables. Outer = flat array. Inner = array-of-arrays, index-aligned
  (inner[0] = sub-items for outer[0], inner[1] = sub-items for outer[1], etc.)
Outer repeat: set_repeat(outerId, { mapPath: "variables['PLANS_UUID']" })
Inner repeat: set_repeat(innerId, { mapPath: "getByIndex(variables['FEATURES_UUID'], context?.item?.data?.index)" })
  getByIndex picks the sub-array at the outer item's position index.
  The executor auto-detects this as a formula and stores it as { formula: "..." }.
Inner text binding: context?.item?.data?.text
Outer field inside inner template: context?.item?.parent?.data?.name

### Scope reference (all patterns)
- context?.item?.data?.FIELD — current (innermost) repeat item field
- context?.item?.data?.index — 0-based position of current item in its array
- context?.item?.data?.value — raw value when iterating a primitive array
- context?.item?.parent?.data?.FIELD — outer repeat item (ONLY valid inside a nested repeat at depth 2+)
- .parent is NOT valid at depth 1 (single repeat) — only inside an inner repeat template.

## Sequential Step Ordering

Steps execute in sequence — each step reads the current store value of every variable.
If step A updates variable X, step B sees the new value of X, not the original.
When step B's formula needs the old value of X, put step B before step A.`;
