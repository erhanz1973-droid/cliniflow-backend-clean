import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

export type SearchBarProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
};

/**
 * Search field with a visible label — no placeholder; prefer `label` + i18n.
 */
export function SearchBar({
  label,
  value,
  onChangeText,
  autoCapitalize = "none",
  autoCorrect = false,
}: SearchBarProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, marginBottom: 14 },
  label: { fontSize: 13, color: "#94a3b8" },
  input: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    padding: 12,
    color: "#fff",
    backgroundColor: "#020617",
    fontSize: 16,
  },
});
