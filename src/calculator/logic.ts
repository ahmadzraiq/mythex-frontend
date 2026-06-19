import { defineWorkflow, vars, params } from 'builder'

export default defineWorkflow({ path: 'workflows/handleButtonPress', trigger: 'click' }, function() {
  const buttonType = params['buttonType']
  const value      = params['value']
  const display    = vars['store/displayValue']
  const op         = vars['store/operation']
  const prev       = vars['store/previousValue']
  const reset      = vars['store/shouldReset']

  // Helper to compute a binary operation
  const compute = (a: number, b: number, o: string): number => {
    if (o === '+') return a + b
    if (o === '-') return a - b
    if (o === '*') return a * b
    if (o === '/') return b === 0 ? 0 : a / b
    return b
  }

  // Format number for display (trim long floats, no trailing zeros)
  const format = (n: number): string => {
    if (!isFinite(n)) return 'Error'
    let s = String(n)
    if (s.length > 9 && s.indexOf('.') !== -1) {
      s = String(parseFloat(n.toFixed(8)))
    }
    return s
  }

  if (buttonType === 'number') {
    if (reset || display === '0') {
      vars['store/displayValue'] = value
    } else {
      vars['store/displayValue'] = display + value
    }
    vars['store/shouldReset'] = false

  } else if (buttonType === 'decimal') {
    if (reset) {
      vars['store/displayValue'] = '0.'
      vars['store/shouldReset'] = false
    } else if (display.indexOf('.') === -1) {
      vars['store/displayValue'] = display + '.'
    }

  } else if (buttonType === 'operator') {
    // Chained operation: if an operation is pending and a new number was entered, evaluate first
    if (op !== '' && !reset) {
      const result = compute(parseFloat(prev), parseFloat(display), op)
      vars['store/displayValue'] = format(result)
      vars['store/previousValue'] = result
    } else {
      vars['store/previousValue'] = parseFloat(display)
    }
    vars['store/operation'] = value
    vars['store/shouldReset'] = true

  } else if (buttonType === 'equals') {
    if (op !== '') {
      const result = compute(parseFloat(prev), parseFloat(display), op)
      vars['store/displayValue'] = format(result)
      vars['store/previousValue'] = result
      vars['store/operation'] = ''
      vars['store/shouldReset'] = true
    }

  } else if (buttonType === 'clear') {
    vars['store/displayValue'] = '0'
    vars['store/operation'] = ''
    vars['store/previousValue'] = 0
    vars['store/shouldReset'] = false

  } else if (buttonType === 'toggle') {
    const n = parseFloat(display)
    vars['store/displayValue'] = format(n * -1)

  } else if (buttonType === 'percent') {
    const n = parseFloat(display)
    vars['store/displayValue'] = format(n / 100)
  }
})
