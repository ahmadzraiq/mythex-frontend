/**
 * decompile-components.ts — reconstructs `defineComponent` declarations from shared-components.json.
 *
 * Only entries with `_dslName` + `_src` are emitted (DSL-authored components).
 */

import fs from 'fs'
import path from 'path'
import type { DecompiledEntry } from './decompile-vars'
import { nodeToJsx } from './decompile-node'
import type { UuidMap } from './uuid-map'

interface ScProperty {
  id: string
  name: string
  type?: string
  defaultValue?: unknown
}

interface ScTrigger {
  id: string
  name: string
  domEvent?: string
}

interface ScVariable {
  id: string
  label: string
  type?: string
  initialValue?: unknown
}

interface ScFormula {
  id: string
  name: string
  formula?: string
}

interface ScWorkflowStep {
  id: string
  type: string
  config?: Record<string, unknown>
}

interface ScWorkflow {
  id: string
  name: string
  params?: string[]
  steps?: ScWorkflowStep[]
}

interface ScEntry {
  id: string
  name: string
  _dslName?: string
  _src?: string
  properties?: ScProperty[]
  triggers?: ScTrigger[]
  content?: Record<string, unknown>
  variables?: Record<string, ScVariable>
  formulas?: Record<string, ScFormula>
  workflows?: Record<string, ScWorkflow>
}

/**
 * Reconstruct workflow steps as DSL statements (for component-internal workflows).
 * `varIdToName` maps variable/workflow IDs back to their local DSL names.
 */
function decompileWorkflowSteps(steps: ScWorkflowStep[], varIdToName: Map<string, string>): string[] {
  const stmts: string[] = []
  for (const step of steps) {
    if (step.type === 'changeVariableValue') {
      const cfg = step.config ?? {}
      const varId = String(cfg.variableName ?? '')
      const localName = varIdToName.get(varId) ?? varId
      const val = cfg.value
      let valStr: string
      if (val === null || val === undefined) {
        valStr = 'null'
      } else if (typeof val === 'object' && 'js' in (val as Record<string, unknown>)) {
        // Resolve any variable IDs in the JS expression back to local names
        let jsExpr = String((val as Record<string, unknown>).js)
        for (const [id, name] of varIdToName.entries()) {
          jsExpr = jsExpr.replace(new RegExp(`variables\\['${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\]`, 'g'), name)
        }
        valStr = jsExpr
      } else {
        valStr = JSON.stringify(val)
      }
      stmts.push(`setVar(${localName}, ${valStr})`)
    } else if (step.type === 'runJavaScript') {
      let code = String((step.config ?? {}).code ?? '')
      for (const [id, name] of varIdToName.entries()) {
        code = code.replace(new RegExp(`variables\\['${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\]`, 'g'), name)
      }
      stmts.push(code)
    } else if (step.type === 'navigateTo') {
      const navPath = String((step.config ?? {}).path ?? '')
      stmts.push(`navigate(${JSON.stringify(navPath)})`)
    } else if (step.type === 'fetchCollection') {
      const col = String((step.config ?? {}).collectionName ?? '')
      stmts.push(`fetch(${JSON.stringify(col)})`)
    }
  }
  return stmts.length > 0 ? stmts : ['// no steps']
}

export function decompileComponents(uuidMap: UuidMap, knownScNames: Set<string>, configDir?: string): DecompiledEntry[] {
  const dir = configDir ?? path.join(process.cwd(), 'config')
  const results: DecompiledEntry[] = []

  let scJson: Record<string, ScEntry> | null = null
  try {
    scJson = JSON.parse(fs.readFileSync(path.join(dir, 'shared-components.json'), 'utf-8'))
  } catch {
    return results
  }

  if (!scJson) return results

  let order = 0
  for (const [, entry] of Object.entries(scJson)) {
    const exportName = entry._dslName
    const src = entry._src
    if (!exportName || !src) continue

    const componentId = entry.id ?? exportName
    const props: string[] = []
    const triggers: string[] = []
    const schemaProps: Record<string, unknown> = {}
    const schemaTriggers: string[] = []

    // Props
    for (const prop of entry.properties ?? []) {
      const typeMap: Record<string, string> = {
        text: 'string', Text: 'string',
        number: 'number', Number: 'number',
        boolean: 'boolean', Boolean: 'boolean',
        array: 'array', Array: 'array',
        object: 'object', Object: 'object',
      }
      const dslType = typeMap[prop.type ?? 'text'] ?? 'string'
      const schemaEntry: Record<string, unknown> = { type: dslType }
      if (prop.defaultValue !== undefined) schemaEntry.default = prop.defaultValue
      schemaProps[prop.name] = schemaEntry
      props.push(prop.name)
    }

    // Triggers
    for (const trigger of entry.triggers ?? []) {
      schemaTriggers.push(trigger.name)
      triggers.push(trigger.name)
    }

    // Schema object
    const schemaParts: string[] = []
    if (Object.keys(schemaProps).length > 0) {
      const propsObj = Object.entries(schemaProps)
        .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)
        .join(',\n')
      schemaParts.push(`  props: {\n${propsObj}\n  }`)
    }
    if (schemaTriggers.length > 0) {
      schemaParts.push(`  triggers: [${schemaTriggers.map(t => JSON.stringify(t)).join(', ')}]`)
    }
    const schemaStr = schemaParts.length > 0 ? `{\n${schemaParts.join(',\n')}\n}` : '{}'

    // Render param destructuring: ({ label, type, onPress })
    const allParams = [...props, ...triggers]
    const paramStr = allParams.length > 0 ? `({ ${allParams.join(', ')} })` : '()'

    // Build internal name map: varId → localName (for decompiling workflow steps)
    const varIdToName = new Map<string, string>()
    for (const [varId, varDef] of Object.entries(entry.variables ?? {})) {
      varIdToName.set(varId, varDef.label)
    }
    for (const [fnId, fnDef] of Object.entries(entry.formulas ?? {})) {
      varIdToName.set(fnId, fnDef.name)
    }
    for (const [wfId, wfDef] of Object.entries(entry.workflows ?? {})) {
      varIdToName.set(wfId, wfDef.name)
    }

    // Internal state statements emitted at the top of the render body
    const internalStateLines: string[] = []

    // Variables: const count = defineVar(0)
    for (const varDef of Object.values(entry.variables ?? {})) {
      const initVal = JSON.stringify(varDef.initialValue ?? null)
      internalStateLines.push(`  const ${varDef.label} = defineVar(${initVal})`)
    }

    // Formulas: const display = defineFunction((n: number) => String(n))
    for (const fnDef of Object.values(entry.formulas ?? {})) {
      const formula = fnDef.formula ?? 'undefined'
      internalStateLines.push(`  const ${fnDef.name} = defineFunction(${formula})`)
    }

    // Internal workflows: const increment = defineWorkflow(() => { setVar(count, count + 1) })
    // Only include workflows whose id matches the 'componentId-wf-' pattern (not trigger workflows)
    const triggerWfIds = new Set((entry.triggers ?? []).map(t => `${componentId}-wf-${t.name}`))
    for (const [wfId, wfDef] of Object.entries(entry.workflows ?? {})) {
      if (triggerWfIds.has(wfId)) continue // external trigger workflow — skip
      const stmts = decompileWorkflowSteps(wfDef.steps ?? [], varIdToName)
      internalStateLines.push(`  const ${wfDef.name} = defineWorkflow(() => {\n    ${stmts.join('\n    ')}\n  })`)
    }

    // Render the content tree
    let jsxStr = '<Box />'
    if (entry.content) {
      try {
        jsxStr = nodeToJsx(entry.content as never, uuidMap, 1, knownScNames)
      } catch { /* keep placeholder */ }
    }

    let bodyStr: string
    if (internalStateLines.length > 0) {
      // Use block-body render function with internal state + return
      bodyStr = `{\n${internalStateLines.join('\n')}\n  return (\n${jsxStr}\n  )\n}`
    } else {
      bodyStr = `(\n${jsxStr}\n)`
    }

    results.push({
      text: `export const ${exportName} = defineComponent(${JSON.stringify(componentId)}, ${schemaStr}, ${paramStr} => ${bodyStr})`,
      srcFile: src,
      kind: 'component',
      order: order++,
    })
  }

  return results
}
