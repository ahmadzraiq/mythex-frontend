/**
 * Web stub for @react-native-masked-view/masked-view.
 * On web, masking is done via CSS mask-image — this component is never rendered.
 */
import React from 'react';

const MaskedView: React.FC<{ children?: React.ReactNode; maskElement?: React.ReactNode; style?: object }> = ({ children }) =>
  React.createElement(React.Fragment, null, children);

export default MaskedView;
export { MaskedView };
