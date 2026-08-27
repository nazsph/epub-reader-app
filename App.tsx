import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EpubReader, type EpubReaderRef } from 'react-native-epub-reader';

export default function App() {
  const reader = useRef<EpubReaderRef>(null);
  const [bookUri, setBookUri] = useState<string>();
  const [bookName, setBookName] = useState<string>();

  const pickBook = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/zip'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      setBookName(result.assets[0].name.replace(/\.epub$/i, ''));
      setBookUri(result.assets[0].uri);
    } catch (cause) {
      console.error(cause);
    }
  };

  return (
    <View style={styles.screen}>
      <EpubReader
        ref={reader}
        source={bookUri}
        title={bookName}
style={{
    borderRadius: 16,
    marginTop: 26,
  }}        renderHeaderRight={({ theme }) => (
          <Pressable
            accessibilityLabel="EPUB dosyası seç"
            onPress={pickBook}
            style={[styles.pickButton, { backgroundColor: theme.ui.activeBg }]}
          >
            <Text style={[styles.pickButtonText, { color: theme.ui.text }]}>Dosya Seç</Text>
          </Pressable>
        )}
        renderEmpty={() => (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyTitle}>EPUB Kitap Okuyucu</Text>
            <Text style={styles.emptySubtitle}>
              Okumaya başlamak için telefonunuzdan bir EPUB kitabı seçin.
            </Text>
            <Pressable style={styles.emptyButton} onPress={pickBook}>
              <Text style={styles.emptyButtonText}>EPUB Dosyası Seç</Text>
            </Pressable>
          </View>
        )}
      />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pickButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickButtonText: { fontSize: 12, fontWeight: '700' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: '#fbf0d9',
  },
  emptyIcon: { fontSize: 64, marginBottom: 8 },
  emptyTitle: { fontSize: 22, fontWeight: 'bold', color: '#2e241d' },
  emptySubtitle: { fontSize: 14, color: '#746457', textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  emptyButton: {
    backgroundColor: '#2e241d',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  emptyButtonText: { color: '#fffaf0', fontSize: 15, fontWeight: '700' },
});
