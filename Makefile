LLVM ?= $(shell brew --prefix llvm)
LLD  ?= $(shell brew --prefix lld)

CXX     := $(LLVM)/bin/clang++
WASM_LD := $(LLD)/bin/wasm-ld

CXXFLAGS := --target=wasm32 -std=c++20 -O3 -ffreestanding -nostdlib \
            -fno-exceptions -fno-rtti -Wall -Wextra
LDFLAGS  := --no-entry --strip-all

OUT := web/fractals.wasm
OBJ := build/fractals.o

.PHONY: all serve clean

all: $(OUT)

$(OBJ): src/fractals.cpp
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(OUT): $(OBJ)
	$(WASM_LD) $(LDFLAGS) $< -o $@

serve: all
	@echo "Open http://localhost:8000"
	python3 -m http.server 8000 --directory web

clean:
	rm -rf build $(OUT)
