#!/usr/bin/env bash
# safer version: keeps going even if one file fails to convert

set -uo pipefail
# NOTE: we intentionally do NOT use `set -e` anymore,
# so one bad file won't kill the whole run.

########################################
# CONFIG - tweak if you want
########################################
INPUT_DIR="unused"        # source images
OUTPUT_DIR="output2"      # compressed copies go here
QUALITY=82               # first-pass quality for jpg/png -> webp
RECOMPRESS_QUALITY=70    # second-pass "crush" quality
BAR_WIDTH=40             # how wide the ASCII bars are

########################################
# UTILS
########################################

get_size_bytes() {
  # Cross-platform file size: GNU stat vs BSD stat (macOS)
  local f="$1"
  if stat -c%s "$f" >/dev/null 2>&1; then
    stat -c%s "$f"
  else
    stat -f%z "$f"
  fi
}

scan_dir_to_list() {
  # scan_dir_to_list DIR OUTFILE
  # Writes TSV lines: <size_bytes>\t<ext>\t<fullpath>
  local ROOT="$1"
  local OUT="$2"

  : > "$OUT"

  find "$ROOT" -type f \( \
    -iname '*.jpg'  -o \
    -iname '*.jpeg' -o \
    -iname '*.png'  -o \
    -iname '*.webp' \
  \) -print0 | \
  while IFS= read -r -d '' file; do
    size=$(get_size_bytes "$file")
    ext="${file##*.}"
    ext_lower=$(printf "%s" "$ext" | tr '[:upper:]' '[:lower:]')
    printf "%s\t%s\t%s\n" "$size" "$ext_lower" "$file" >> "$OUT"
  done
}

bytes_to_mb() {
  local b="$1"
  awk -v bb="$b" 'BEGIN { printf("%.2f", bb/1048576) }'
}

get_total_bytes() {
  local LIST="$1"
  awk -F'\t' '{s+=$1} END{if(s==""){s=0}; print s}' "$LIST"
}

print_report() {
  # print_report LISTFILE LABEL
  local LIST="$1"
  local LABEL="$2"

  local total_count
  total_count=$(wc -l < "$LIST" || echo 0)

  echo "============================================================"
  echo "REPORT: $LABEL"

  if [ "$total_count" -eq 0 ]; then
    echo "No images found."
    echo "============================================================"
    echo
    return
  fi

  local total_bytes
  total_bytes=$(get_total_bytes "$LIST")
  local total_mb
  total_mb=$(bytes_to_mb "$total_bytes")

  echo "Total images: $total_count"
  echo "Total size  : $total_mb MB"
  echo

  # By extension
  echo "By extension (count / total MB):"
  awk -F'\t' '{c[$2]++; s[$2]+=$1} END {for (e in c) printf "%s\t%d\t%s\n", e, c[e], s[e]}' "$LIST" \
    | sort -nrk3,3 > /tmp/ext_stats.$$ || true

  while IFS=$'\t' read -r ext cnt bytes; do
    mb=$(bytes_to_mb "$bytes")
    printf "  %-6s %5s files  %8s MB\n" "$ext" "$cnt" "$mb"
  done < /tmp/ext_stats.$$ || true
  echo

  # Extension size distribution graph
  echo "File type size distribution graph:"
  local max_ext_bytes
  max_ext_bytes=$(head -n1 /tmp/ext_stats.$$ | cut -f3)
  if [ -z "${max_ext_bytes:-}" ] || [ "${max_ext_bytes:-0}" -eq 0 ] 2>/dev/null; then
    max_ext_bytes=1
  fi

  while IFS=$'\t' read -r ext cnt bytes; do
    local barlen=$(( bytes * BAR_WIDTH / max_ext_bytes ))
    if [ "$barlen" -lt 1 ]; then barlen=1; fi
    local bar
    bar=$(printf "%${barlen}s" "" | tr ' ' '#')
    mb=$(bytes_to_mb "$bytes")
    printf "  %-6s | %s (%.2f MB)\n" "$ext" "$bar" "$mb"
  done < /tmp/ext_stats.$$ || true

  rm -f /tmp/ext_stats.$$ || true
  echo

  # Top ~10% largest files
  echo "Top ~10% largest files:"
  sort -nrk1,1 "$LIST" > /tmp/sorted_files.$$ || true

  localN=$(awk -v n="$total_count" 'BEGIN {
    x = n * 0.10;
    xn = int(x);
    if (x > xn) { xn = xn + 1; }
    if (xn < 1) { xn = 1; }
    print xn;
  }')

  head -n "$localN" /tmp/sorted_files.$$ > /tmp/topN.$$ || true

  local idx=1
  while IFS=$'\t' read -r bytes ext path; do
    mb=$(bytes_to_mb "$bytes")
    printf "  %2d. %s  (%s MB)\n" "$idx" "$path" "$mb"
    idx=$((idx+1))
  done < /tmp/topN.$$ || true
  echo

  # Bar graph of top ~10%
  echo "Top ~10% bar graph:"
  max_bytes=$(head -n1 /tmp/topN.$$ | cut -f1)
  if [ -z "${max_bytes:-}" ] || [ "${max_bytes:-0}" -eq 0 ] 2>/dev/null; then
    max_bytes=1
  fi

  idx=1
  while IFS=$'\t' read -r bytes ext path; do
    barlen=$(( bytes * BAR_WIDTH / max_bytes ))
    if [ "$barlen" -lt 1 ]; then barlen=1; fi
    bar=$(printf "%${barlen}s" "" | tr ' ' '#')

    justname=$(basename "$path")
    mb=$(bytes_to_mb "$bytes")

    printf "  %2d. %-30s | %s (%.2f MB)\n" "$idx" "$justname" "$bar" "$mb"
    idx=$((idx+1))
  done < /tmp/topN.$$ || true

  rm -f /tmp/sorted_files.$$ /tmp/topN.$$ || true
  echo "============================================================"
  echo
}

print_savings() {
  # print_savings BEFORE_LIST AFTER_LIST LABEL
  local BEFORE_LIST="$1"
  local AFTER_LIST="$2"
  local LABEL="$3"

  local before_bytes after_bytes before_mb after_mb saved_mb saved_pct

  before_bytes=$(get_total_bytes "$BEFORE_LIST")
  after_bytes=$(get_total_bytes "$AFTER_LIST")

  before_mb=$(bytes_to_mb "$before_bytes")
  after_mb=$(bytes_to_mb "$after_bytes")

  saved_mb=$(awk -v b="$before_bytes" -v a="$after_bytes" 'BEGIN {
    diff = b-a;
    printf("%.2f", diff/1048576);
  }')

  saved_pct=$(awk -v b="$before_bytes" -v a="$after_bytes" 'BEGIN {
    if (b==0) { printf("0.0"); next }
    diff = b-a;
    pct = (diff/b)*100.0;
    printf("%.1f", pct);
  }')

  echo "---- SIZE CHANGE ($LABEL) ----"
  echo "Before : $before_mb MB"
  echo "After  : $after_mb MB"
  echo "Saved  : $saved_mb MB (${saved_pct}%)"
  echo "--------------------------------"
  echo
}

safe_encode_webp() {
  # safe_encode_webp SRC DST QUALITY
  local SRC="$1"
  local DST="$2"
  local Q="$3"

  # try encode; if it fails, warn but don't exit script
  if cwebp -q "$Q" -mt "$SRC" -o "$DST" >/dev/null 2>&1; then
    return 0
  else
    echo "[ERROR] cwebp failed on $SRC" >&2
    # make sure we don't leave a partial .tmp
    [ -f "$DST" ] && rm -f "$DST"
    return 1
  fi
}

convert_all_to_webp() {
  # convert_all_to_webp LISTFILE
  # - For .jpg/.jpeg/.png: encode -> .webp at QUALITY
  # - For .webp: copy as-is
  # Output paths mirror INPUT_DIR but land under OUTPUT_DIR.
  local LIST="$1"

  while IFS=$'\t' read -r bytes ext src; do
    # build destination path
    rel="${src#$INPUT_DIR/}"
    dst="$OUTPUT_DIR/${rel%.*}.webp"

    mkdir -p "$(dirname "$dst")"

    if [ "$ext" = "webp" ]; then
      echo "[COPY]        $src"
      echo "   -> $dst"
      if ! cp -f "$src" "$dst" 2>/dev/null; then
        echo "[ERROR] copy failed for $src" >&2
      fi
    else
      echo "[ENCODE q=$QUALITY] $src"
      echo "   -> $dst"
      safe_encode_webp "$src" "$dst" "$QUALITY"
    fi
  done < "$LIST"
}

recompress_top_webp() {
  # recompress_top_webp LISTFILE TOP_N
  # Take TOP_N largest .webp inside OUTPUT_DIR and recompress them in-place
  # at RECOMPRESS_QUALITY.
  local LIST="$1"
  local TOP_N="$2"

  # build list of just .webp under OUTPUT_DIR, largest first
  awk -F'\t' -v root="$OUTPUT_DIR" '$2=="webp" && index($3, root"/")==1 {print}' "$LIST" \
    | sort -nrk1,1 \
    | head -n "$TOP_N" \
    > /tmp/recomp_list.$$ || true

  if [ ! -s /tmp/recomp_list.$$ ]; then
    echo "No .webp files found for recompress."
    rm -f /tmp/recomp_list.$$ || true
    return
  fi

  echo "Recompressing top $TOP_N .webp files in $OUTPUT_DIR at q=$RECOMPRESS_QUALITY"
  while IFS=$'\t' read -r bytes ext path; do
    tmp="${path}.tmp.webp"
    echo "[RECOMP q=$RECOMPRESS_QUALITY] $path"
    # same 'safe encode' trick, but source and dest are both webp
    if cwebp -q "$RECOMPRESS_QUALITY" -mt "$path" -o "$tmp" >/dev/null 2>&1; then
      mv -f "$tmp" "$path"
    else
      echo "[ERROR] recompress failed on $path" >&2
      [ -f "$tmp" ] && rm -f "$tmp"
    fi
  done < /tmp/recomp_list.$$

  rm -f /tmp/recomp_list.$$ || true
}

########################################
# MAIN FLOW
########################################

echo "=== STEP 1: Scan & report on '$INPUT_DIR' ==="
SCAN_BEFORE=$(mktemp)
scan_dir_to_list "$INPUT_DIR" "$SCAN_BEFORE"
print_report "$SCAN_BEFORE" "BEFORE (INPUT_DIR)"

# Ask user if we should convert
read -r -p "Convert everything to '$OUTPUT_DIR' as .webp? (Non-webp -> q=$QUALITY, webp -> copy) [y/N]: " ans
ans=${ans:-N}
if [ "$ans" != "y" ] && [ "$ans" != "Y" ]; then
  echo "Aborting after analysis."
  rm -f "$SCAN_BEFORE"
  exit 0
fi

echo
echo "=== STEP 2: Convert to WebP in '$OUTPUT_DIR' ==="
mkdir -p "$OUTPUT_DIR"
convert_all_to_webp "$SCAN_BEFORE"

echo
echo "=== STEP 2b: Re-scan '$OUTPUT_DIR' and show new report ==="
SCAN_AFTER1=$(mktemp)
scan_dir_to_list "$OUTPUT_DIR" "$SCAN_AFTER1"
print_report "$SCAN_AFTER1" "AFTER FIRST PASS (OUTPUT_DIR)"
print_savings "$SCAN_BEFORE" "$SCAN_AFTER1" "AFTER FIRST PASS"

# Ask if we want a second squeeze
read -r -p "Optional STEP 3: recompress biggest .webp in '$OUTPUT_DIR' at q=$RECOMPRESS_QUALITY.
Enter how many largest .webp files to crush (e.g. 10), or press Enter to skip: " again
again=${again:-}

if [ -n "$again" ] && [[ "$again" =~ ^[0-9]+$ ]] && [ "$again" -gt 0 ]; then
  echo
  echo "=== STEP 3: Recompress top $again .webp files ==="
  recompress_top_webp "$SCAN_AFTER1" "$again"

  echo
  echo "=== STEP 3b: Final re-scan '$OUTPUT_DIR' ==="
  SCAN_AFTER2=$(mktemp)
  scan_dir_to_list "$OUTPUT_DIR" "$SCAN_AFTER2"
  print_report "$SCAN_AFTER2" "AFTER RECOMPRESS (OUTPUT_DIR)"
  print_savings "$SCAN_BEFORE" "$SCAN_AFTER2" "FINAL"

  rm -f "$SCAN_AFTER2"
else
  echo "Skipping recompress."
fi

rm -f "$SCAN_BEFORE" "$SCAN_AFTER1"
echo "Done."
