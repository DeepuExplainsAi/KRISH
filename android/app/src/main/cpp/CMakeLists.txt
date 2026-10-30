cmake_minimum_required(VERSION 3.22.1)
project(krish_llama LANGUAGES C CXX)

if(NOT ANDROID OR NOT ANDROID_ABI STREQUAL "arm64-v8a")
  message(FATAL_ERROR "Krish native inference is Android arm64-v8a only")
endif()

# llama.cpp b12001, tag resolves to this immutable commit. Download SOURCE at build time only;
# verify the archive before CMake reads it. No model weights or prebuilt binaries are fetched.
include(FetchContent)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
FetchContent_Declare(llama_cpp
  URL https://codeload.github.com/ggml-org/llama.cpp/tar.gz/eb4e244be77a906a183cd4a00fd51d9ad3200955
  URL_HASH SHA256=bd2f111a77f617614fd58e1202bed7d0249d3ea8949ad8a1a183915d612f0aad)
FetchContent_MakeAvailable(llama_cpp)

add_library(krish_llama SHARED krish_llama_jni.cpp)
target_compile_features(krish_llama PRIVATE cxx_std_17)
target_link_libraries(krish_llama PRIVATE llama llama-common)
