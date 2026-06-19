import { definePage, Box, Text, vars, workflow } from 'builder'

export default definePage({ path: 'Calculator', title: 'Calculator', layout: 'full' }, () => (
  <Box tw="min-h-screen w-full bg-black flex items-end justify-center pb-10">
    <Box tw="w-full max-w-sm px-3">

      {/* Title */}
      <Box tw="px-4 pt-2 flex justify-start">
        <Text tw="text-gray-500 text-sm font-medium tracking-wide">Calculator</Text>
      </Box>

      {/* Display */}
      <Box tw="px-4 py-4 flex justify-end items-end min-h-[140px]">
        <Text tw="text-white text-8xl font-light tracking-tight truncate">
          {vars['store/displayValue']}
        </Text>
      </Box>

      {/* Keypad */}
      <Box tw="grid grid-cols-4 gap-3">
        {vars['store/buttons'].map((btn: any) => (
          <Box
            key={btn.label}
            tw={
              btn.wide
                ? 'col-span-2 rounded-full h-20 flex items-center justify-start pl-8 cursor-pointer select-none active:opacity-70 transition-opacity'
                : 'rounded-full h-20 flex items-center justify-center cursor-pointer select-none active:opacity-70 transition-opacity'
            }
            style={{
              backgroundColor: btn.color,
              border:
                btn.type === 'operator' && btn.value === vars['store/operation']
                  ? '3px solid #FF9500'
                  : '3px solid transparent',
              boxShadow:
                btn.type === 'operator' && btn.value === vars['store/operation']
                  ? '0 0 16px rgba(255, 149, 0, 0.8)'
                  : 'none',
            }}
            onClick={workflow('workflows/handleButtonPress', {
              buttonType: btn.type,
              value: btn.value ?? btn.label,
            })}
          >
            <Text tw="text-3xl font-medium" style={{ color: btn.text }}>
              {btn.type === 'clear' && vars['store/displayValue'] !== '0'
                ? 'C'
                : btn.label}
            </Text>
          </Box>
        ))}
      </Box>

    </Box>
  </Box>
))
