import { defineVar } from 'builder'

export const displayValue  = defineVar('string', '0')
export const previousValue = defineVar('number', 0)
export const operation     = defineVar('string', '')
export const shouldReset   = defineVar('boolean', false)

export const buttons = defineVar('array', [
  { label: 'AC',  type: 'clear',    color: '#A5A5A5', text: '#000000' },
  { label: '+/-', type: 'toggle',   color: '#A5A5A5', text: '#000000' },
  { label: '%',   type: 'percent',  color: '#A5A5A5', text: '#000000' },
  { label: '÷',   type: 'operator', value: '/', color: '#FF9500', text: '#FFFFFF' },

  { label: '7', type: 'number', value: '7', color: '#333333', text: '#FFFFFF' },
  { label: '8', type: 'number', value: '8', color: '#333333', text: '#FFFFFF' },
  { label: '9', type: 'number', value: '9', color: '#333333', text: '#FFFFFF' },
  { label: '×', type: 'operator', value: '*', color: '#FF9500', text: '#FFFFFF' },

  { label: '4', type: 'number', value: '4', color: '#333333', text: '#FFFFFF' },
  { label: '5', type: 'number', value: '5', color: '#333333', text: '#FFFFFF' },
  { label: '6', type: 'number', value: '6', color: '#333333', text: '#FFFFFF' },
  { label: '−', type: 'operator', value: '-', color: '#FF9500', text: '#FFFFFF' },

  { label: '1', type: 'number', value: '1', color: '#333333', text: '#FFFFFF' },
  { label: '2', type: 'number', value: '2', color: '#333333', text: '#FFFFFF' },
  { label: '3', type: 'number', value: '3', color: '#333333', text: '#FFFFFF' },
  { label: '+', type: 'operator', value: '+', color: '#FF9500', text: '#FFFFFF' },

  { label: '0', type: 'number', value: '0', color: '#333333', text: '#FFFFFF', wide: true },
  { label: '.', type: 'decimal', color: '#333333', text: '#FFFFFF' },
  { label: '=', type: 'equals', value: '=', color: '#FF9500', text: '#FFFFFF' },
])
