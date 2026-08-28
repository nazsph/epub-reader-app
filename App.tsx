import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { BlurView } from "expo-blur";
import {
  Alert,
  BackHandler,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  EpubReader,
  type EpubFlow,
  type EpubLocation,
  type EpubReaderRef,
  type ThemePreset,
  type TocItem,
} from "react-native-epub-reader";

import { MaterialIcons } from "@expo/vector-icons";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";

type Bookmark = {
  id: string;
  cfi: string;
  label: string;
  progression: number;
  date: string;
};

type RecentBook = {
  name: string;
  uri: string;
  lastCfi?: string;
  lastReadDate: string;
  progression?: number;
};

type FlatToc = TocItem & { level: number };

function flattenToc(items: TocItem[], level = 0): FlatToc[] {
  let result: FlatToc[] = [];
  for (const item of items) {
    result.push({ ...item, level });
    if (item.subitems && item.subitems.length > 0) {
      result = result.concat(flattenToc(item.subitems, level + 1));
    }
  }
  return result;
}

export default function App() {
  const reader = useRef<EpubReaderRef>(null);

  // Book & location state
  const [bookUri, setBookUri] = useState<string>();
  const [bookName, setBookName] = useState<string>();
  const [initialLocation, setInitialLocation] = useState<string | undefined>(
    undefined,
  );
  const [currentLocation, setCurrentLocation] = useState<EpubLocation>();
  const [progression, setProgression] = useState<number>(0);
  const [toc, setToc] = useState<TocItem[]>([]);

  // History & Bookmarks
  const [recentBooks, setRecentBooks] = useState<RecentBook[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // Reader Settings State (Theme, Font Size, Flow)
  const [readerTheme, setReaderTheme] = useState<ThemePreset>("sepia");
  const [readerFontSize, setReaderFontSize] = useState<number>(18);
  const [readerFlow, setReaderFlow] = useState<EpubFlow>("paginated");

  // Modals state
  const [isTocVisible, setIsTocVisible] = useState(false);
  const [isBookmarksVisible, setIsBookmarksVisible] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load recently read books & reader settings on mount
  useEffect(() => {
    loadRecentBooks();
    loadReaderSettings();
  }, []);

  const loadReaderSettings = async () => {
    try {
      const data = await AsyncStorage.getItem("@epub_reader_settings");
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.theme) setReaderTheme(parsed.theme);
        if (parsed.fontSize) setReaderFontSize(parsed.fontSize);
        if (parsed.flow) setReaderFlow(parsed.flow);
      }
    } catch (err) {
      console.warn("Failed to load reader settings:", err);
    }
  };

  const saveReaderSetting = async (key: string, value: unknown) => {
    try {
      const data = await AsyncStorage.getItem("@epub_reader_settings");
      const current = data ? JSON.parse(data) : {};
      current[key] = value;
      await AsyncStorage.setItem(
        "@epub_reader_settings",
        JSON.stringify(current),
      );
    } catch (err) {
      console.warn("Failed to save reader settings:", err);
    }
  };

  const handleThemeChange = async (preset: string) => {
    setReaderTheme(preset as ThemePreset);
    await saveReaderSetting("theme", preset);
  };

  const handleFontSizeChange = async (size: number) => {
    setReaderFontSize(size);
    await saveReaderSetting("fontSize", size);
  };

  const handleFlowChange = async (flow: EpubFlow) => {
    setReaderFlow(flow);
    await saveReaderSetting("flow", flow);
  };

  // Handle hardware Android back button to return to Home Screen instead of exiting app
  useEffect(() => {
    const onBackPress = () => {
      if (bookUri) {
        closeReader();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress,
    );
    return () => backHandler.remove();
  }, [bookUri, bookName, currentLocation, progression]);

  const loadRecentBooks = async () => {
    try {
      const data = await AsyncStorage.getItem("@epub_recent_books");
      if (data) {
        setRecentBooks(JSON.parse(data));
      }
    } catch (err) {
      console.warn("Failed to load recent books:", err);
    }
  };

  const saveRecentBook = async (
    name: string,
    uri: string,
    cfi?: string,
    pct?: number,
  ) => {
    try {
      const now = new Date().toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const existingData = await AsyncStorage.getItem("@epub_recent_books");
      let list: RecentBook[] = existingData ? JSON.parse(existingData) : [];

      const currentItem = list.find((b) => b.name === name || b.uri === uri);
      const updatedItem: RecentBook = {
        name,
        uri,
        lastCfi: cfi || currentItem?.lastCfi,
        lastReadDate: now,
        progression:
          typeof pct === "number" ? pct : currentItem?.progression || 0,
      };

      list = [
        updatedItem,
        ...list.filter((b) => b.name !== name && b.uri !== uri),
      ];
      setRecentBooks(list);
      await AsyncStorage.setItem("@epub_recent_books", JSON.stringify(list));
    } catch (err) {
      console.warn("Failed to save recent book:", err);
    }
  };

  const removeRecentBook = async (name: string) => {
    try {
      const updated = recentBooks.filter((b) => b.name !== name);
      setRecentBooks(updated);
      await AsyncStorage.setItem("@epub_recent_books", JSON.stringify(updated));
      await AsyncStorage.removeItem(`@epub_last_location_${name}`);
      await AsyncStorage.removeItem(`@epub_bookmarks_${name}`);
      if (bookName === name) {
        setInitialLocation(undefined);
      }
      showToast("Kitap geçmişten silindi");
    } catch (err) {
      console.warn("Failed to remove recent book:", err);
    }
  };

  // Close reader and return to Home/Library screen
  const closeReader = async () => {
    if (bookName && bookUri && currentLocation?.cfi) {
      await saveRecentBook(bookName, bookUri, currentLocation.cfi, progression);
    }
    setBookUri(undefined);
    await loadRecentBooks();
  };

  // Load saved bookmarks for current book
  const loadBookmarks = async (bookKey: string) => {
    try {
      const data = await AsyncStorage.getItem(`@epub_bookmarks_${bookKey}`);
      if (data) {
        setBookmarks(JSON.parse(data));
      } else {
        setBookmarks([]);
      }
    } catch (err) {
      console.warn("Failed to load bookmarks:", err);
    }
  };

  // Pick EPUB Book and restore last read location
  const pickBook = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/epub+zip", "application/zip"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;

      const fileAsset = result.assets[0];
      const cleanName = fileAsset.name.replace(/\.epub$/i, "");
      setBookName(cleanName);

      // Check if there is a saved last-read location for this book
      const savedLocation = await AsyncStorage.getItem(
        `@epub_last_location_${cleanName}`,
      );
      if (savedLocation) {
        console.log(
          `[Demo] Restoring saved location for ${cleanName}:`,
          savedLocation,
        );
        setInitialLocation(savedLocation);
      } else {
        console.log(
          `[Demo] No saved location found for ${cleanName}, starting from beginning.`,
        );
        setInitialLocation(undefined);
      }

      const recent = recentBooks.find((b) => b.name === cleanName);
      if (recent && typeof recent.progression === "number") {
        setProgression(recent.progression);
      } else {
        setProgression(0);
      }

      await loadBookmarks(cleanName);
      await saveRecentBook(
        cleanName,
        fileAsset.uri,
        savedLocation || undefined,
        recent?.progression,
      );
      setBookUri(fileAsset.uri);
    } catch (cause) {
      console.error("Book picking error:", cause);
    }
  };

  // Open book from recent list
  const openRecentBook = async (item: RecentBook) => {
    try {
      setBookName(item.name);
      if (typeof item.progression === "number") {
        setProgression(item.progression);
      } else {
        setProgression(0);
      }
      const savedLocation =
        (await AsyncStorage.getItem(`@epub_last_location_${item.name}`)) ||
        item.lastCfi;
      setInitialLocation(savedLocation || undefined);
      await loadBookmarks(item.name);
      await saveRecentBook(
        item.name,
        item.uri,
        savedLocation || undefined,
        item.progression,
      );
      setBookUri(item.uri);
      showToast(`📖 ${item.name} açılıyor...`);
    } catch (err) {
      console.error("Failed to open recent book:", err);
    }
  };

  // Handle location changes and save progress to AsyncStorage
  const handleLocationChange = async (location: EpubLocation) => {
    setCurrentLocation(location);
    const pct =
      typeof location.progression === "number"
        ? location.progression
        : progression;
    if (typeof location.progression === "number") {
      setProgression(location.progression);
    }

    if (bookName && location.cfi) {
      try {
        await AsyncStorage.setItem(
          `@epub_last_location_${bookName}`,
          location.cfi,
        );
        if (bookUri) {
          await saveRecentBook(bookName, bookUri, location.cfi, pct);
        }
      } catch (err) {
        console.warn("Failed to save location:", err);
      }
    }
  };

  // Add new bookmark at current location
  const addBookmark = async () => {
    if (!bookName || !currentLocation?.cfi) {
      Alert.alert(
        "Bilgi",
        "Kitap henüz yüklenmedi veya sayfa konumu alınamadı.",
      );
      return;
    }

    const pageLabel = currentLocation.displayed
      ? `Sayfa ${currentLocation.displayed.page}`
      : `%${Math.round((currentLocation.progression || progression) * 100)}`;

    const newBookmark: Bookmark = {
      id: Date.now().toString(),
      cfi: currentLocation.cfi,
      label: `${bookName} - ${pageLabel}`,
      progression: currentLocation.progression || progression,
      date: new Date().toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    const updated = [newBookmark, ...bookmarks];
    setBookmarks(updated);
    try {
      await AsyncStorage.setItem(
        `@epub_bookmarks_${bookName}`,
        JSON.stringify(updated),
      );
      showToast("Yer imi kaydedildi!");
    } catch (err) {
      console.warn("Failed to save bookmark:", err);
    }
  };

  // Delete a bookmark
  const removeBookmark = async (id: string) => {
    if (!bookName) return;
    const updated = bookmarks.filter((b) => b.id !== id);
    setBookmarks(updated);
    try {
      await AsyncStorage.setItem(
        `@epub_bookmarks_${bookName}`,
        JSON.stringify(updated),
      );
      showToast("Yer imi silindi");
    } catch (err) {
      console.warn("Failed to delete bookmark:", err);
    }
  };

  // Jump to a bookmark
  const goToBookmark = (cfi: string) => {
    setIsBookmarksVisible(false);
    reader.current?.goTo(cfi);
  };

  // Jump to TOC chapter
  const goToTocChapter = (href: string) => {
    setIsTocVisible(false);
    reader.current?.goTo(href);
  };

  // Draggable slider state for bottom progress bar
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPercentage, setSeekPercentage] = useState<number>(0);
  const trackWidthRef = useRef<number>(200);

  const displayPct = isSeeking ? seekPercentage : progression;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          setIsSeeking(true);
          const { locationX } = evt.nativeEvent;
          const width = trackWidthRef.current || 200;
          const pct = Math.max(0, Math.min(1, locationX / width));
          setSeekPercentage(pct);
        },
        onPanResponderMove: (evt) => {
          const { locationX } = evt.nativeEvent;
          const width = trackWidthRef.current || 200;
          const pct = Math.max(0, Math.min(1, locationX / width));
          setSeekPercentage(pct);
        },
        onPanResponderRelease: (evt) => {
          const { locationX } = evt.nativeEvent;
          const width = trackWidthRef.current || 200;
          const pct = Math.max(0, Math.min(1, locationX / width));
          setSeekPercentage(pct);
          setIsSeeking(false);
          reader.current?.goToPercentage(pct);
        },
        onPanResponderTerminate: () => {
          setIsSeeking(false);
        },
      }),
    [reader],
  );

  // Quick jump percentage
  const handleSeekPercentage = (targetPct: number) => {
    const clamped = Math.max(0, Math.min(1, targetPct));
    setProgression(clamped);
    reader.current?.goToPercentage(clamped);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2200);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={styles.screen}
        edges={["top", "bottom", "left", "right"]}
      >
        {/* Toast Notification */}
        {toastMessage && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        )}

        {/* Page 2: Reader Screen (When a book is loaded) */}
        {bookUri ? (
          <View style={styles.readerContainer}>
            <EpubReader
              key={bookUri}
              ref={reader}
              source={bookUri}
              title={bookName}
              initialLocation={initialLocation}
              defaultTheme={readerTheme}
              defaultFontSize={readerFontSize}
              defaultFlow={readerFlow}
              onThemeChange={(preset) => handleThemeChange(preset)}
              onFontSizeChange={handleFontSizeChange}
              onFlowChange={handleFlowChange}
              onTocChange={(items) => setToc(items)}
              onLocationChange={handleLocationChange}
              onControlsVisibilityChange={(visible) =>
                setIsControlsVisible(visible)
              }
              showTocButton={false}
              renderHeaderLeft={({ theme }) => (
                <View style={styles.headerLeftGroup}>
                  {/* Back to Home / Library Button */}
                  <Pressable
                    accessibilityLabel="Kitaplığa Dön"
                    onPress={closeReader}
                    style={styles.iconButton}
                  >
                    <MaterialIcons
                      name="arrow-back"
                      size={22}
                      color={theme.ui.text}
                    />
                  </Pressable>

                  {/* Table of Contents Button */}
                  <Pressable
                    accessibilityLabel="İçindekiler"
                    onPress={() => setIsTocVisible(true)}
                    style={styles.iconButton}
                  >
                    <MaterialIcons
                      name="menu-book"
                      size={22}
                      color={theme.ui.text}
                    />
                  </Pressable>
                </View>
              )}
              renderHeaderRight={({ theme }) => (
                <View style={styles.headerActions}>
                  {/* Add Bookmark Button */}
                  <Pressable
                    accessibilityLabel="Yer İmi Ekle"
                    onPress={addBookmark}
                    style={[
                      styles.actionBtn,
                      { backgroundColor: theme.ui.activeBg },
                    ]}
                  >
                    <MaterialIcons
                      name="bookmark-add"
                      size={22}
                      color={theme.ui.text}
                    />
                  </Pressable>

                  {/* Open Bookmarks List */}
                  <Pressable
                    accessibilityLabel="Yer İmleri"
                    onPress={() => setIsBookmarksVisible(true)}
                    style={[
                      styles.actionBtn,
                      { backgroundColor: theme.ui.activeBg },
                    ]}
                  >
                    <MaterialIcons
                      name="bookmarks"
                      size={20}
                      color={theme.ui.text}
                    />
                    {bookmarks.length > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{bookmarks.length}</Text>
                      </View>
                    )}
                  </Pressable>
                </View>
              )}
              // style={{ height: "50%", alignSelf: "center", marginTop: 20 }}
            />

            {/* Interactive Bottom Progress Bar for Fast Seeking */}
            {isControlsVisible && (
              <View style={styles.bottomBar}>
                <BlurView
                  intensity={50}
                  tint="light"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor: "rgba(255, 255, 255, 0.15)",
                    },
                  ]}
                />
                <TouchableOpacity
                  style={styles.seekStepBtn}
                  onPress={() => handleSeekPercentage(displayPct - 0.05)}
                >
                  <Text style={styles.seekStepText}>-5%</Text>
                </TouchableOpacity>

                <View
                  style={styles.progressTrackWrapper}
                  onLayout={(e) => {
                    trackWidthRef.current = e.nativeEvent.layout.width;
                  }}
                  {...panResponder.panHandlers}
                >
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.max(0, Math.min(100, Math.round(displayPct * 100)))}%`,
                        },
                      ]}
                    />
                  </View>
                  {/* Draggable Knob / Thumb (Nokta) */}
                  <View
                    style={[
                      styles.progressThumb,
                      {
                        left: `${Math.max(0, Math.min(100, displayPct * 100))}%`,
                      },
                    ]}
                  />
                </View>

                <TouchableOpacity
                  style={styles.seekStepBtn}
                  onPress={() => handleSeekPercentage(displayPct + 0.05)}
                >
                  <Text style={styles.seekStepText}>+5%</Text>
                </TouchableOpacity>

                <Text style={styles.progressInfoText}>
                  %{Math.round(displayPct * 100)}
                </Text>
              </View>
            )}
          </View>
        ) : (
          /* Page 1: Home / Library Screen with Recommendations */
          <ScrollView
            contentContainerStyle={styles.emptyScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.emptyHero,
                { paddingVertical: recentBooks.length > 0 ? 28 : "50%" },
              ]}
            >
              <Text style={styles.emptyIcon}>
                <FontAwesome6
                  name="book-open-reader"
                  size={60}
                  color="black"
                />{" "}
              </Text>
              <Text style={styles.emptyTitle}>EPUB Kitap Okuyucu</Text>
              <Text style={styles.emptySubtitle}>
                Okumaya başlamak için cihazınızdan yeni bir EPUB dosyası seçin
                veya daha önce okuduğunuz kitaplardan devam edin.
              </Text>
              <TouchableOpacity style={styles.emptyButton} onPress={pickBook}>
                <MaterialIcons name="menu-book" size={22} color={"white"} />
                <Text style={styles.emptyButtonText}>
                  Yeni EPUB Dosyası Seç
                </Text>
              </TouchableOpacity>
            </View>

            {/* Recommended / Recently Read Books from AsyncStorage */}
            {recentBooks.length > 0 && (
              <View style={styles.recentSection}>
                <View style={styles.recentHeader}>
                  <Text style={styles.recentSectionTitle}>
                    Kaldığınız Yerden Devam Edin
                  </Text>
                  <Text style={styles.recentSectionBadge}>
                    {recentBooks.length} Kitap
                  </Text>
                </View>

                <View style={styles.recentList}>
                  {recentBooks.map((item) => (
                    <TouchableOpacity
                      key={item.name}
                      style={styles.recentCard}
                      activeOpacity={0.7}
                      onPress={() => openRecentBook(item)}
                    >
                      <View style={styles.recentCardLeft}>
                        <Text style={styles.recentBookIcon}>
                          <MaterialIcons
                            name="menu-book"
                            size={26}
                            color={"black"}
                          />
                        </Text>
                        <View style={styles.recentCardInfo}>
                          <Text
                            style={styles.recentBookTitle}
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                          <Text style={styles.recentBookMeta}>
                            {item.lastReadDate} • İlerleme: %
                            {Math.round((item.progression || 0) * 100)}
                          </Text>
                          {/* Mini progress bar */}
                          <View style={styles.miniProgressTrack}>
                            <View
                              style={[
                                styles.miniProgressFill,
                                {
                                  width: `${Math.max(4, Math.round((item.progression || 0) * 100))}%`,
                                },
                              ]}
                            />
                          </View>
                        </View>
                      </View>

                      <View style={styles.recentCardActions}>
                        <TouchableOpacity
                          style={styles.removeRecentBtn}
                          onPress={() => removeRecentBook(item.name)}
                        >
                          <MaterialIcons
                            name="close"
                            size={18}
                            color="#a08e7e"
                          />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        )}

        {/* Table of Contents (TOC) Modal */}
        <Modal
          visible={isTocVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setIsTocVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <SafeAreaView
              style={styles.drawerContainer}
              edges={["top", "bottom"]}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>İçindekiler</Text>
                <Pressable
                  onPress={() => setIsTocVisible(false)}
                  style={styles.closeBtn}
                >
                  <MaterialIcons name="close" size={22} color="#746457" />
                </Pressable>
              </View>

              {toc.length === 0 ? (
                <View style={styles.emptyModalContent}>
                  <Text style={styles.emptyModalText}>
                    İçindekiler listesi bulunamadı.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={flattenToc(toc)}
                  keyExtractor={(item, index) =>
                    item.id || item.href || String(index)
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.tocItem,
                        { paddingLeft: 18 + (item.level || 0) * 16 },
                      ]}
                      onPress={() => goToTocChapter(item.href)}
                    >
                      <Text style={styles.tocItemText} numberOfLines={2}>
                        {item.label?.trim() || "Bölüm"}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              )}
            </SafeAreaView>
          </View>
        </Modal>

        {/* Bookmarks (Yer İmleri) Modal */}
        <Modal
          visible={isBookmarksVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setIsBookmarksVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <SafeAreaView
              style={styles.drawerContainer}
              edges={["top", "bottom"]}
            >
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleContainer}>
                  <MaterialIcons name="bookmarks" size={20} color="#746457" />
                  <Text style={styles.modalTitle}>Kayıtlı Yer İmleri</Text>
                </View>
                <Pressable
                  onPress={() => setIsBookmarksVisible(false)}
                  style={styles.closeBtn}
                >
                  <MaterialIcons name="close" size={22} color="#746457" />
                </Pressable>
              </View>

              {bookmarks.length === 0 ? (
                <View style={styles.emptyModalContent}>
                  <MaterialIcons
                    name="bookmarks"
                    size={42}
                    color="#746457"
                  ></MaterialIcons>
                  <Text style={styles.emptyModalText}>
                    Henüz bir yer imi eklenmemiş.
                  </Text>
                  <Text style={styles.emptyModalSubtext}>
                    Üst bardaki yer imi butonuna dokunarak okuduğunuz sayfayı
                    yer imlerine ekleyebilirsiniz.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={bookmarks}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.bookmarkItem}>
                      <TouchableOpacity
                        style={styles.bookmarkContent}
                        onPress={() => goToBookmark(item.cfi)}
                      >
                        <Text style={styles.bookmarkTitle}>{item.label}</Text>
                        <Text style={styles.bookmarkSub}>
                          {item.date} • %
                          {Math.round((item.progression || 0) * 100)}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.deleteBookmarkBtn}
                        onPress={() => removeBookmark(item.id)}
                      >
                        <MaterialIcons
                          name="delete-outline"
                          size={22}
                          color="#8a7364"
                        />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              )}
            </SafeAreaView>
          </View>
        </Modal>

        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "transparent",
  },
  readerContainer: { flex: 1, position: "relative" },

  // Header Left & Right Groups
  headerLeftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonText: { fontSize: 18, fontWeight: "bold" },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  actionBtnIcon: { fontSize: 16 },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#ff6e07",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#ffffff", fontSize: 10, fontWeight: "bold" },
  pickButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  pickButtonText: { fontSize: 12, fontWeight: "700" },

  // Bottom Progress Bar & Seeking
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: "transparent",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#d7c8b7",
    gap: 8,
  },
  seekStepBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#e8ddd0",
    borderRadius: 6,
  },
  seekStepText: { fontSize: 11, fontWeight: "700", color: "#2e241d" },
  progressTrackWrapper: {
    flex: 1,
    height: 28,
    justifyContent: "center",
    position: "relative",
  },
  progressTrack: {
    width: "100%",
    height: 6,
    backgroundColor: "#e8ddd0",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#2e241d",
    borderRadius: 3,
  },
  progressThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#f4ebd0",
    borderColor: "#2e241d",
    borderWidth: 2.5,
    marginLeft: -9,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  progressInfoText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2e241d",
    minWidth: 42,
    textAlign: "right",
  },

  // Toast Notification
  toast: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    backgroundColor: "rgba(30, 20, 10, 0.9)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 999,
    elevation: 8,
  },
  toastText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },

  // Empty State & Hero
  emptyScrollContent: {
    padding: 24,
    paddingBottom: 32,
  },
  emptyHero: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    gap: 12,
  },
  emptyIcon: { fontSize: 60, marginBottom: 4 },
  emptyTitle: { fontSize: 24, fontWeight: "bold", color: "#2e241d" },
  emptySubtitle: {
    fontSize: 14,
    color: "#746457",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  emptyButton: {
    backgroundColor: "#2e241d",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyButtonText: {
    color: "#fffaf0",
    fontSize: 15,
    fontWeight: "700",
  },
  // Recent Books / Recommendations
  recentSection: {
    marginTop: 18,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#d7c8b7",
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  recentSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#2e241d",
  },
  recentSectionBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: "#746457",
    backgroundColor: "#e8ddd0",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  recentList: {
    gap: 10,
  },
  recentCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f4ebd0",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d7c8b7",
  },
  recentCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  recentBookIcon: {
    fontSize: 26,
  },
  recentCardInfo: {
    flex: 1,
  },
  recentBookTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#2e241d",
    marginBottom: 3,
  },
  recentBookMeta: {
    fontSize: 12,
    color: "#746457",
    marginBottom: 6,
  },
  miniProgressTrack: {
    height: 4,
    backgroundColor: "#d7c8b7",
    borderRadius: 2,
    overflow: "hidden",
    maxWidth: 160,
  },
  miniProgressFill: {
    height: "100%",
    backgroundColor: "#746457",
    borderRadius: 2,
  },
  recentCardActions: {
    paddingLeft: 8,
  },
  removeRecentBtn: {
    padding: 6,
  },
  removeRecentText: {
    fontSize: 14,
    color: "#a08e7e",
    fontWeight: "bold",
  },

  // Modal / Drawer Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    flexDirection: "row",
  },
  drawerContainer: {
    width: "82%",
    maxWidth: 360,
    height: "100%",
    backgroundColor: "#fbf0d9",
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d7c8b7",
  },
  modalTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#2e241d" },
  closeBtn: { padding: 6 },
  closeBtnText: { fontSize: 16, fontWeight: "bold", color: "#746457" },

  tocItem: {
    paddingVertical: 14,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d7c8b7",
  },
  tocItemText: { fontSize: 14, lineHeight: 20, color: "#2e241d" },

  bookmarkItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d7c8b7",
  },
  bookmarkContent: { flex: 1, marginRight: 10 },
  bookmarkTitle: { fontSize: 14, fontWeight: "700", color: "#2e241d" },
  bookmarkSub: { fontSize: 12, color: "#746457", marginTop: 2 },
  deleteBookmarkBtn: { padding: 8 },
  deleteBookmarkText: { fontSize: 16 },

  emptyModalContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  emptyModalIcon: { fontSize: 44, marginBottom: 4 },
  emptyModalText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2e241d",
    textAlign: "center",
  },
  emptyModalSubtext: {
    fontSize: 12,
    color: "#746457",
    textAlign: "center",
    lineHeight: 18,
  },
});
